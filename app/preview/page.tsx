import { HeatLogo } from "../heat-logo";
import Link from "next/link";
import { ArrowLeft, BookOpen } from "lucide-react";
import { DishCard } from "../workspace";
export default function Preview() {
  return (
    <main className="min-h-screen">
      <div className="bg-ink px-5 py-3 text-center text-sm text-white">
        Employee screen preview · Sample content · No data is saved
      </div>
      <header className="border-b border-line bg-surface p-5">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <span className="flex items-center gap-2 text-2xl font-black">
            <HeatLogo />
          </span>
          <Link href="/" className="flex items-center gap-2 text-sm">
            <ArrowLeft size={17} />
            Back
          </Link>
        </div>
      </header>
      <div className="mx-auto max-w-3xl p-5 md:p-9">
        <p className="eyebrow muted mt-4 mb-3">Ready for service</p>
        <h1 className="text-2xl font-semibold md:text-2xl">
          HEAT Demo Kitchen
        </h1>
        <p className="muted mt-3 mb-8">
          Get to know every dish before your next shift.
        </p>
        <div className="mb-5 flex items-center gap-2 text-sm font-semibold">
          <BookOpen size={18} />
          Menu library <span className="muted ml-auto">1 dish</span>
        </div>
        <DishCard
          item={{
            id: "sample",
            restaurant_id: "sample",
            name: "Grilled Chicken Caesar",
            category: "Mains",
            description:
              "Charred chicken breast over crisp romaine, with shaved parmesan, croutons and a garlic dressing.",
            ingredients: ["Chicken", "Romaine", "Parmesan", "Croutons", "Caesar dressing"],
            allergens: ["Milk", "Gluten", "Egg", "Fish"],
            photo_path: "",
          }}
        />
        <p className="muted mt-5 text-center text-sm">
          Your uploaded dish photo will appear above the description.
        </p>
      </div>
    </main>
  );
}
