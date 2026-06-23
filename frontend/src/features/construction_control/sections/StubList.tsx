// DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// StubList - a thin, reusable read-only list shell for the pillar sections
// whose create/action forms are fleshed out by follow-up work. It handles the
// loading / error / empty / loaded states consistently (SkeletonTable +
// EmptyState + a simple table) so each stub section only declares its columns
// and how to map a row. The create/action UI is marked with an explicit
// TODO(pillar) placeholder in each section.

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, EmptyState, SkeletonTable } from '@/shared/ui';

export interface StubColumn<T> {
  key: string;
  header: string;
  /** Cell renderer; receives the row. */
  render: (row: T) => ReactNode;
  className?: string;
}

export interface StubListProps<T> {
  rows: T[];
  columns: StubColumn<T>[];
  isLoading: boolean;
  isError: boolean;
  rowKey: (row: T) => string;
  testIdPrefix: string;
  emptyIcon: ReactNode;
  emptyTitle: string;
  emptyDescription: string;
}

export function StubList<T>({
  rows,
  columns,
  isLoading,
  isError,
  rowKey,
  testIdPrefix,
  emptyIcon,
  emptyTitle,
  emptyDescription,
}: StubListProps<T>) {
  const { t } = useTranslation();

  if (isLoading) {
    return <SkeletonTable rows={4} columns={Math.max(columns.length, 3)} />;
  }
  if (isError) {
    return (
      <Card>
        <div className="p-6 text-sm text-semantic-error">
          {t('construction_control.load_error_generic', {
            defaultValue: 'Could not load this list. Please try again.',
          })}
        </div>
      </Card>
    );
  }
  if (rows.length === 0) {
    return <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-light text-left text-xs text-content-tertiary">
              {columns.map((col) => (
                <th key={col.key} className={`px-4 py-2.5 font-medium ${col.className ?? ''}`}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                className="border-b border-border-light/60 last:border-b-0 align-top"
                data-testid={`${testIdPrefix}-row-${rowKey(row)}`}
              >
                {columns.map((col) => (
                  <td key={col.key} className={`px-4 py-3 ${col.className ?? ''}`}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
