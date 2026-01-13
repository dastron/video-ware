import React from 'react';
import { LabelsNav } from './labels-nav';

export default function LabelsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="container mx-auto py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Label Inspector</h1>
      </div>
      <LabelsNav />
      {children}
    </div>
  );
}
