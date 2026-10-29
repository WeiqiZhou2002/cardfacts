# Phase 2 catalog and evidence limits

The draft now contains 30 US products: 20 personal and 10 business, across seven issuer/product brands.
The 27 additions were researched on 2026-10-28 against public issuer product pages, benefit guides and
issuer search excerpts. Each version points to its exact source record. No issuer page text is committed.
The original three products retain their prior verification dates; coverage metadata is added and the
Venture X entertainment earn rule is newly cited. The previous seed contents remain in full snapshots.

## Coverage

| Brand            | Personal products                                                     | Business products                                                                       |
| ---------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| American Express | Platinum, Gold, Blue Cash Preferred, Blue Cash Everyday               | Business Platinum, Business Gold, Blue Business Plus, Blue Business Cash                |
| Chase            | Sapphire Reserve, Sapphire Preferred, Freedom Unlimited, Freedom Flex | Ink Business Preferred, Ink Business Cash, Ink Business Unlimited, Ink Business Premier |
| Capital One      | Venture X, Venture, Savor, Quicksilver                                | Venture X Business, Spark Cash Plus                                                     |
| Citi             | Strata Premier, Strata Elite, Double Cash                             | —                                                                                       |
| Wells Fargo      | Autograph, Autograph Journey, Active Cash                             | —                                                                                       |
| Discover         | Discover it Cash Back                                                 | —                                                                                       |
| U.S. Bank        | Altitude Go                                                           | —                                                                                       |

The issuer field identifies the catalog's product brand; it is not a legal-creditor registry. In particular,
Discover branding does not assert an independent current corporate owner. Networks not confirmed from
the reviewed material are null. Card-specific `coverage` records distinguish reviewed sections from
partial sections. `reviewed` describes the cited evidence review, not an exhaustive financial contract;
notes and merchant exclusions always remain part of eligibility. Optional fees commonly remain null.
An empty credit list means no covered recurring credit was captured, not proof that no benefit exists.

## Known follow-up work

- Existing pending credits in the Phase 1 seeds remain pending; an unchanged migration is not verification.
- Discover's live calendar rendered an error. Its indexed official excerpt named the 2026 Q4 categories;
  the schedule is retained as `to_verify` with a null rate until the live calendar can be verified.
- American Express Gold's large product page was only partly available through indexed official excerpts;
  the separate Membership Guide and benefits page support the main rewards and credit terms. Optional
  fees and exhaustive exclusions need further review.
- Business Gold advertising/wireless and Business Platinum shipping/wireless have announced select-merchant
  restrictions for 2027-02-17. New pending versions stop the current unrestricted descriptions from being
  applied indefinitely. The eligible merchant lists remain to be checked.
- Freedom Flex quarterly rewards preserve the issuer's advertised 5% rate. Combining quarterly and
  ongoing category bonuses is not calculated. Freedom partner promotions and Sapphire Preferred's
  Peloton cap and precise vacation-rental merchant list remain partial.
- Multi-year credits use the existing `since_last_credit` representation; where the issuer states only
  “every four years,” exact anniversary computation is labeled inferred. Do not turn statement billing
  cycles into invented fixed-day posting limits.
- Altitude Go's activity-dependent credit and Autograph Journey's annual-fee-month reset need consumer
  support for the new reset bases; they cannot use ordinary calendar-year or opening-anniversary math.
- Per-stay property credits, anniversary reward-point gifts, signup offers, insurance, membership-value
  estimates and account-specific offers are outside the periodic reimbursement amounts collected here.

No card recommendation or estimated total annual value is generated. Unknown starts remain unknown;
current research does not reconstruct issuer history before evidence exists. All seven brands remain
`manual_only` for the scheduled fetcher pending automation policy review.

## History and compatibility

Schema version 2 adds nullable networks, coverage, top-spend/rotating selectors, purchase/payment/time
conditions, credit spend thresholds and two special reset bases. Consumers must recognize these fields
and bases before evaluating eligibility. The original 23 progress fixtures are unchanged and only cover
their original supported subset; this catalog does not implement a rewards or reimbursement calculator.

Full revisions and the history export are described in [history.md](history.md). The three original seed
snapshots are followed by the Phase 2 snapshots, making editorial and fact additions visible without Git.
Later correction snapshots, when needed, preserve the earlier draft just as a wiki preserves old pages.
