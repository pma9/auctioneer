"use client";

import { useId, useState } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";

type Props = {
  label?: string;
  trigger?: "button" | "link";
  className?: string;
};

const rulesSections = [
  {
    title: 'The "Sealed Bid" Surprise',
    items: [
      {
        label: "Your Secret is Safe",
        text: 'Every bid you place is "sealed," meaning only you and the auction organizer can see it.',
      },
      {
        label: "The Winner's Discount",
        text: "If you have the highest bid when the timer runs out, you win! However, you only pay the second-highest bid amount (or the starting price if you were the only bidder). It pays to bid your true maximum!",
      },
      {
        label: "Handling Ties",
        text: "In the event of a tie, the earliest bid placed wins the item. In this specific case, because the second-highest bid is the same as your winning bid, you would pay your exact bid amount.",
      },
    ],
  },
  {
    title: 'The "Lock-In" Race',
    items: [
      {
        label: "Skip the Wait",
        text: 'See something you absolutely must have? If your bid is equal to or higher than the "Lock-In Price," you’ll see an option to "Lock In" the item.',
      },
      {
        label: "Instant Winner",
        text: 'The first person to click "Lock In" wins the item immediately, and the auction for that item ends right then and there.',
      },
      {
        label: "The Catch",
        text: 'Unlike regular bids, a "Lock-In" bid is a final sale at your exact bid price. No Vickrey discounts here—just the guaranteed prize!',
      },
    ],
  },
  {
    title: "Manage Your Bids",
    items: [
      {
        label: "Flexibility",
        text: "You can edit or remove your regular bids as often as you like until the timer hits zero.",
      },
      {
        label: "Commitment",
        text: 'Once you "Lock In" an item, that bid is permanent.',
      },
      {
        label: "Know Your Budget",
        text: 'Check your dashboard to see your "Total Max Commitment" (the most you could possibly spend) and your "Minimum Due".',
      },
      {
        label: "Important Note",
        text: 'You likely will not have to pay your "Total Max Commitment." That number represents your maximum ceiling, but thanks to the Vickrey discount, your final total will typically be much lower.',
      },
    ],
  },
];

export function AuctionRulesModal({
  label = "Click here to see how it works.",
  trigger = "link",
  className,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const titleId = useId();
  const triggerClassName =
    className ??
    (trigger === "button"
      ? "button-light mt-5 inline-flex w-full text-lg sm:w-auto"
      : "font-bold text-amber-700 underline decoration-amber-300 underline-offset-4 hover:text-amber-800");

  return (
    <>
      <button className={triggerClassName} type="button" onClick={() => setIsOpen(true)}>
        {label}
      </button>

      {isOpen && (
        <div
          aria-labelledby={titleId}
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          onClick={() => setIsOpen(false)}
          role="dialog"
        >
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white p-6 text-slate-950 shadow-xl lg:max-w-4xl"
            initial={{ opacity: 0, y: 24 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-700">RULES</p>
                <h2 className="mt-2 text-2xl font-bold" id={titleId}>
                  Welcome to Auctioneer!
                </h2>
              </div>
              <button
                aria-label="Close rules"
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 transition hover:bg-slate-200 hover:text-slate-950"
                type="button"
                onClick={() => setIsOpen(false)}
              >
                <X aria-hidden="true" size={22} />
              </button>
            </div>

            <p className="mt-4 text-sm leading-6 text-slate-600">
              We’re thrilled to have you. To keep things fair and exciting, we use a special{" "}
              {'"Hybrid Vickrey"'} auction style. Here is how you can win your favorite items:
            </p>

            <div className="mt-6 space-y-6">
              {rulesSections.map((section) => (
                <section key={section.title}>
                  <h3 className="text-lg font-bold text-slate-950">{section.title}</h3>
                  <div className="mt-3 space-y-3">
                    {section.items.map((item) => (
                      <p
                        className="rounded-2xl bg-slate-100 p-4 text-sm leading-6 text-slate-700"
                        key={item.label}
                      >
                        <span className="font-bold text-slate-950">{item.label}:</span> {item.text}
                      </p>
                    ))}
                  </div>
                </section>
              ))}
            </div>

            <p className="mt-6 font-semibold text-slate-950">Good luck, and happy bidding!</p>

            <div className="mt-6 flex justify-center border-t border-slate-200 pt-6">
              <button
                className="button inline-flex w-full sm:w-auto"
                type="button"
                onClick={() => setIsOpen(false)}
              >
                Close
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </>
  );
}
