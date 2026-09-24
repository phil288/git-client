import { repoInitials, stringHue } from '@shared/display'
import { cn } from '@/lib/utils'

export function RepoAvatar({ name, size = 32, dimmed, className }: { name: string; size?: number; dimmed?: boolean; className?: string }) {
  const hue = stringHue(name)
  return (
    <div
      aria-hidden
      className={cn('flex shrink-0 items-center justify-center rounded-md font-semibold text-white', dimmed && 'grayscale opacity-50', className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        background: `linear-gradient(135deg, hsl(${hue} 60% 50%), hsl(${(hue + 40) % 360} 55% 40%))`
      }}
    >
      {repoInitials(name)}
    </div>
  )
}
