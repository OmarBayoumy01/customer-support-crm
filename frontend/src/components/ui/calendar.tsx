'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DayPicker } from 'react-day-picker';

import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-3 relative', className)}
      classNames={{
        months: 'flex flex-col sm:flex-row gap-4 relative',
        month: 'space-y-3 relative',
        month_caption: 'flex justify-center items-center h-8 relative mb-1',
        caption_label: 'text-sm font-semibold text-foreground',
        nav: 'flex items-center',
        button_previous: cn(
          buttonVariants({ variant: 'outline' }),
          'absolute start-0 top-0 size-8 bg-transparent p-0 opacity-70 hover:opacity-100 z-10 rounded-md',
        ),
        button_next: cn(
          buttonVariants({ variant: 'outline' }),
          'absolute end-0 top-0 size-8 bg-transparent p-0 opacity-70 hover:opacity-100 z-10 rounded-md',
        ),
        month_grid: 'w-full border-collapse space-y-1',
        weekdays: 'flex w-full justify-between mb-1',
        weekday:
          'text-muted-foreground rounded-md w-9 font-normal text-[0.8rem] text-center',
        week: 'flex w-full justify-between mt-1',
        day: cn(
          'relative p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-accent',
          props.mode === 'range'
            ? '[&:has(>.day-range-end)]:rounded-e-md [&:has(>.day-range-start)]:rounded-s-md first:[&:has([aria-selected])]:rounded-s-md last:[&:has([aria-selected])]:rounded-e-md'
            : '[&:has([aria-selected])]:rounded-md',
        ),
        day_button: cn(
          buttonVariants({ variant: 'ghost' }),
          'size-9 p-0 font-normal aria-selected:opacity-100 hover:bg-accent hover:text-accent-foreground rounded-md transition-colors',
        ),
        range_start: 'day-range-start bg-primary text-primary-foreground rounded-s-md hover:bg-primary hover:text-primary-foreground',
        range_end: 'day-range-end bg-primary text-primary-foreground rounded-e-md hover:bg-primary hover:text-primary-foreground',
        selected:
          'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground font-semibold',
        today: 'bg-accent/60 text-accent-foreground font-bold',
        outside:
          'day-outside text-muted-foreground/40 aria-selected:bg-accent/50 aria-selected:text-muted-foreground',
        disabled: 'text-muted-foreground/30 opacity-50 cursor-not-allowed',
        range_middle:
          'aria-selected:bg-accent aria-selected:text-accent-foreground rounded-none',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) => {
          if (orientation === 'left') {
            return <ChevronLeft className="size-4 rtl:rotate-180" />;
          }
          return <ChevronRight className="size-4 rtl:rotate-180" />;
        },
      }}
      {...props}
    />
  );
}
Calendar.displayName = 'Calendar';

export { Calendar };
