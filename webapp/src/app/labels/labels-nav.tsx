'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function LabelsNav() {
  const pathname = usePathname();

  const tabs = [
    { name: 'Objects', href: '/labels/objects' },
    { name: 'Faces', href: '/labels/faces' },
    { name: 'People', href: '/labels/people' },
    { name: 'Shots', href: '/labels/shots' },
  ];

  return (
    <div className="flex items-center space-x-2 border-b mb-6 overflow-x-auto">
      {tabs.map((tab) => {
        const isActive = pathname.startsWith(tab.href);
        return (
          <Link key={tab.href} href={tab.href}>
            <Button
              variant={isActive ? 'default' : 'ghost'}
              className="rounded-b-none"
            >
              {tab.name}
            </Button>
          </Link>
        );
      })}
    </div>
  );
}
