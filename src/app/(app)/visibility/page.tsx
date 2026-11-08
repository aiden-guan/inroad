import type { Metadata } from "next";
import { SearchPerformance } from "@/components/visibility/search-performance";
import { PageTransition } from "@/components/shell/page-transition";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { CitationMonitor } from "@/components/integrations/citation-monitor";

export const metadata: Metadata = { title: "Search & AI" };

export default function Page() {
  return <PageTransition><PageContainer>
    <PageHeader title="Search & AI" eyebrow="SEO & AEO" description="Track search visibility, the visits it brings, and the sessions that convert. Compare each source with its own previous period." />
    <div className="mt-8"><SearchPerformance /></div>
    <section className="rounded-xl bg-surface p-5 ring-1 ring-border">
      <h2 className="text-[15px] font-medium">How often do AI answers cite you?</h2>
      <p className="mt-2 max-w-[76ch] text-[13px] leading-6 text-fg-3">Google’s Search Generative AI reports and Bing’s AI Performance report show visibility inside their own products. Referral sessions in PostHog show observed visits after a click. Use both to distinguish visibility from traffic, then track conversions to judge the value of those visits.</p>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-3 text-[13px] font-medium">
        <a href="https://search.google.com/search-console" target="_blank" rel="noreferrer" className="underline underline-offset-4">Google AI reports ↗</a>
        <a href="https://www.bing.com/webmasters/aiperformance" target="_blank" rel="noreferrer" className="underline underline-offset-4">Bing AI Performance ↗</a>
      </div>
      <p className="mt-4 text-[12px] leading-5 text-fg-3">Monid’s Ahrefs snapshots track its sampled citation index by platform and keep matching domain/country baselines. They are paid, on-demand reports. Review Google and Bing’s own AI reports using the links above.</p>
      <CitationMonitor />
    </section>
  </PageContainer></PageTransition>;
}
