import { PageHeader } from "@/components/page-header"
import { BitcoinCard, MarketCapCard } from "@/components/stat-cards"
import { RevenueCard } from "@/components/revenue-card"
import { RetentionCard } from "@/components/retention-card"
import { BalanceCard } from "@/components/balance-card"
import { MarketCard } from "@/components/market-card"

export default function Page() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
      <PageHeader />

      {/* Top row */}
      <div className="flex min-h-0 flex-none flex-col gap-4 lg:flex-[3] lg:basis-0 lg:flex-row">
        <div className="flex min-h-[420px] w-full min-w-0 flex-col gap-4 lg:min-h-0 lg:w-1/3">
          <BitcoinCard />
          <MarketCapCard />
        </div>
        <div className="flex min-h-[360px] w-full min-w-0 lg:min-h-0 lg:w-1/3">
          <RevenueCard />
        </div>
        <div className="flex min-h-[360px] w-full min-w-0 lg:min-h-0 lg:w-1/3">
          <RetentionCard />
        </div>
      </div>

      {/* Bottom row */}
      <div className="flex min-h-0 flex-none flex-col gap-4 lg:flex-[2] lg:basis-0 lg:flex-row">
        <div className="flex min-h-[320px] w-full min-w-0 lg:min-h-0 lg:w-1/2">
          <BalanceCard />
        </div>
        <div className="flex min-h-[320px] w-full min-w-0 lg:min-h-0 lg:w-1/2">
          <MarketCard />
        </div>
      </div>
    </div>
  )
}
