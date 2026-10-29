import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { compare, jsonFiles, readJson, sha256 } from "./catalog.js";
import type { Card, Catalog } from "./types.js";

import { canonical, isTimestamp } from "./primitives.js";
export { canonical, isTimestamp } from "./primitives.js";
export { revisionAt, revisionDiff, termsAt } from "./temporal.js";

export interface Revision {
  format_version: 1;
  id: string;
  product_id: string;
  recorded_at: string;
  reason: string;
  content_sha256: string;
  product: Card;
}
export const revisionHash = (card: Card) => sha256(canonical(card));
export const revisionId = (time: string, hash: string) =>
  `${time.replaceAll(/[-:]/g, "")}-${hash.slice(0, 12)}`;
export async function loadRevisions(
  root: string,
  cards: Card[],
  allowUnrecorded = false,
): Promise<Revision[]> {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  (addFormatsModule.default ?? addFormatsModule)(ajv);
  const cardSchema = (await readJson(join(root, "schema/card.schema.json"))) as object;
  ajv.addSchema(cardSchema, "card");
  const validate = ajv.compile<Revision>(
    (await readJson(join(root, "schema/revision.schema.json"))) as object,
  );
  let files: string[];
  try {
    files = await jsonFiles(join(root, "history"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && allowUnrecorded) return [];
    throw error;
  }
  const revisions: Revision[] = [];
  const errors: string[] = [];
  for (const file of files) {
    const value = await readJson(file);
    if (!validate(value)) {
      errors.push(`${file}: ${ajv.errorsText(validate.errors)}`);
      continue;
    }
    const hash = revisionHash(value.product);
    if (
      !isTimestamp(value.recorded_at) ||
      value.id !== revisionId(value.recorded_at, hash) ||
      value.content_sha256 !== hash ||
      value.product_id !== value.product.id
    )
      errors.push(`${file}: invalid revision identity, timestamp or checksum`);
    if (file !== join(root, "history", value.product_id, `${value.id}.json`))
      errors.push(`${file}: unexpected revision path`);
    if (!cards.some((c) => c.id === value.product_id)) errors.push(`${file}: unknown product`);
    revisions.push(value);
  }
  revisions.sort((a, b) => compare(a.recorded_at, b.recorded_at) || compare(a.id, b.id));
  for (const card of cards) {
    const productHistory = revisions.filter((r) => r.product_id === card.id);
    if (new Set(productHistory.map((r) => r.recorded_at)).size !== productHistory.length)
      errors.push(`${card.id}: revision timestamps must be unique`);
    const latest = productHistory.at(-1);
    if (!allowUnrecorded && (!latest || !isDeepStrictEqual(latest.product, card)))
      errors.push(
        `${card.id}: current data needs a new snapshot (pnpm snapshot ${card.id} --recorded-at TIME --reason TEXT)`,
      );
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return revisions;
}
export async function recordRevision(
  catalog: Catalog,
  productId: string,
  recordedAt: string,
  reason: string,
): Promise<Revision> {
  if (!isTimestamp(recordedAt) || !reason.trim())
    throw new Error("snapshot requires a UTC timestamp YYYY-MM-DDTHH:mm:ssZ and a non-empty reason");
  const card = catalog.cards.find((c) => c.id === productId);
  if (!card) throw new Error(`Unknown product: ${productId}`);
  const revisions = await loadRevisions(catalog.root, catalog.cards, true);
  const latest = revisions.filter((r) => r.product_id === productId).at(-1);
  if (latest && recordedAt <= latest.recorded_at)
    throw new Error("New revision must be recorded after the latest revision");
  if (latest && isDeepStrictEqual(latest.product, card))
    throw new Error("Product is unchanged; no new snapshot is needed");
  const hash = revisionHash(card);
  const revision: Revision = {
    format_version: 1,
    id: revisionId(recordedAt, hash),
    product_id: productId,
    recorded_at: recordedAt,
    reason: reason.trim(),
    content_sha256: hash,
    product: card,
  };
  const directory = join(catalog.root, "history", productId);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${revision.id}.json`), JSON.stringify(revision, null, 2) + "\n", {
    flag: "wx",
  });
  return revision;
}
export function revisionErrors(before: Revision[], after: Revision[]): string[] {
  const errors = before.flatMap((old) => {
    const current = after.find((r) => r.product_id === old.product_id && r.id === old.id);
    return !current || !isDeepStrictEqual(current, old)
      ? [`${old.product_id}/${old.id}: recorded revision was removed or modified`]
      : [];
  });
  for (const revision of after) {
    const previous = before.filter((r) => r.product_id === revision.product_id);
    if (
      !previous.some((r) => r.id === revision.id) &&
      previous.some((r) => r.recorded_at >= revision.recorded_at)
    )
      errors.push(
        `${revision.product_id}/${revision.id}: new revision must be recorded after existing history`,
      );
  }
  return errors;
}
