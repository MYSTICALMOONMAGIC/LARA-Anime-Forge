interface LtxLogoProps {
  className?: string
}

export function LtxLogo({
  className = ''
}: LtxLogoProps) {
  return (
    <div
      className={`inline-flex items-center gap-3 ${className}`}
      aria-label="LARA Anime Forge"
    >
      <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-violet-400/40 bg-gradient-to-br from-violet-950 via-zinc-950 to-fuchsia-950 shadow-lg shadow-violet-950/40">
        <span className="text-lg font-black text-violet-200">
          L
        </span>

        <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-fuchsia-400 shadow-md shadow-fuchsia-400/60" />
      </div>

      <div className="flex flex-col leading-none">
        <span className="whitespace-nowrap text-sm font-bold tracking-[0.22em] text-white">
          LARA
        </span>

        <span className="mt-1 whitespace-nowrap text-[10px] font-medium tracking-[0.14em] text-violet-300">
          ANIME FORGE
        </span>
      </div>
    </div>
  )
}
