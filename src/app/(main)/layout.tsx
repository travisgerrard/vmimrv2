import { Suspense } from "react";
import MainHeader, { HeaderFallback } from "./MainHeader";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="container mx-auto px-4 md:px-8 max-w-4xl font-sans">
      <Suspense fallback={<HeaderFallback />}>
        <MainHeader />
      </Suspense>
      <div className="pb-8">
        {children}
      </div>
    </main>
  );
}
