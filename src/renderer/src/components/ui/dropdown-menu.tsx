import * as React from 'react'
import * as DM from '@radix-ui/react-dropdown-menu'
import { cn } from '@/lib/utils'
import { menuContent, menuItem, menuSeparator } from './menu-styles'

export const DropdownMenu = DM.Root
export const DropdownMenuTrigger = DM.Trigger

export function DropdownMenuContent({ className, sideOffset = 4, ...props }: React.ComponentPropsWithoutRef<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content sideOffset={sideOffset} className={cn(menuContent, className)} {...props} />
    </DM.Portal>
  )
}

export function DropdownMenuItem({ className, ...props }: React.ComponentPropsWithoutRef<typeof DM.Item>) {
  return <DM.Item className={cn(menuItem, className)} {...props} />
}

export function DropdownMenuSeparator() {
  return <DM.Separator className={menuSeparator} />
}
