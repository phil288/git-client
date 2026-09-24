import * as React from 'react'
import * as CM from '@radix-ui/react-context-menu'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { menuContent, menuItem, menuLabel, menuSeparator } from './menu-styles'

export const ContextMenu = CM.Root
export const ContextMenuTrigger = CM.Trigger
export const ContextMenuSub = CM.Sub

export function ContextMenuContent({ className, ...props }: React.ComponentPropsWithoutRef<typeof CM.Content>) {
  return (
    <CM.Portal>
      <CM.Content className={cn(menuContent, className)} {...props} />
    </CM.Portal>
  )
}

export function ContextMenuItem({
  className,
  shortcut,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof CM.Item> & { shortcut?: string }) {
  return (
    <CM.Item className={cn(menuItem, className)} {...props}>
      {children}
      {shortcut && <span className="ml-auto pl-4 text-xs opacity-60">{shortcut}</span>}
    </CM.Item>
  )
}

export function ContextMenuSeparator() {
  return <CM.Separator className={menuSeparator} />
}

export function ContextMenuLabel(props: React.ComponentPropsWithoutRef<typeof CM.Label>) {
  return <CM.Label className={menuLabel} {...props} />
}

export function ContextMenuSubTrigger({ className, children, ...props }: React.ComponentPropsWithoutRef<typeof CM.SubTrigger>) {
  return (
    <CM.SubTrigger className={cn(menuItem, 'data-[state=open]:bg-hover', className)} {...props}>
      {children}
      <ChevronRight className="ml-auto" />
    </CM.SubTrigger>
  )
}

export function ContextMenuSubContent({ className, ...props }: React.ComponentPropsWithoutRef<typeof CM.SubContent>) {
  return (
    <CM.Portal>
      <CM.SubContent className={cn(menuContent, className)} {...props} />
    </CM.Portal>
  )
}
