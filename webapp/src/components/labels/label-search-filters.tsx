'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search } from 'lucide-react';
import { LabelType } from '@project/shared/enums';

export interface LabelSearchFilterValues {
  labelType?: LabelType;
  searchQuery?: string;
  confidenceThreshold?: number;
  minTime?: number;
  maxTime?: number;
}

interface LabelSearchFiltersProps {
  filters: LabelSearchFilterValues;
  onFiltersChange: (filters: LabelSearchFilterValues) => void;
  maxDuration?: number;
}

const LABEL_TYPE_OPTIONS = [
  { value: 'all', label: 'All Types' },
  { value: LabelType.OBJECT, label: 'Object' },
  { value: LabelType.SHOT, label: 'Shot' },
  { value: LabelType.PERSON, label: 'Person' },
  { value: LabelType.SPEECH, label: 'Speech' },
];

export function LabelSearchFilters({
  filters,
  onFiltersChange,
  maxDuration,
}: LabelSearchFiltersProps) {
  const [localSearchQuery, setLocalSearchQuery] = useState(
    filters.searchQuery || ''
  );

  const handleLabelTypeChange = (value: string) => {
    onFiltersChange({
      ...filters,
      labelType: value === 'all' ? undefined : (value as LabelType),
    });
  };

  const handleSearchQueryChange = (value: string) => {
    setLocalSearchQuery(value);
    // Debounce will be handled by parent component
    onFiltersChange({
      ...filters,
      searchQuery: value || undefined,
    });
  };

  const handleConfidenceChange = (value: number[]) => {
    onFiltersChange({
      ...filters,
      confidenceThreshold: value[0],
    });
  };

  const handleTimeRangeChange = (values: number[]) => {
    onFiltersChange({
      ...filters,
      minTime: values[0],
      maxTime: values[1],
    });
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const confidenceValue = filters.confidenceThreshold ?? 0;
  const timeRangeValues = [
    filters.minTime ?? 0,
    filters.maxTime ?? maxDuration ?? 100,
  ];

  return (
    <div className="space-y-4 p-4 border-b">
      {/* Label Type Filter */}
      <div className="space-y-2">
        <Label htmlFor="label-type-select" className="text-sm font-medium">
          Label Type
        </Label>
        <Select
          value={filters.labelType || 'all'}
          onValueChange={handleLabelTypeChange}
        >
          <SelectTrigger id="label-type-select" className="w-full">
            <SelectValue placeholder="Filter by type" />
          </SelectTrigger>
          <SelectContent>
            {LABEL_TYPE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Text Search */}
      <div className="space-y-2">
        <Label htmlFor="search-input" className="text-sm font-medium">
          Search
        </Label>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            id="search-input"
            placeholder="Search labels..."
            value={localSearchQuery}
            onChange={(e) => handleSearchQueryChange(e.target.value)}
            className="pl-8"
          />
        </div>
      </div>

      {/* Confidence Threshold Slider */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="confidence-slider" className="text-sm font-medium">
            Confidence
          </Label>
          <span className="text-sm text-muted-foreground">
            {Math.round(confidenceValue * 100)}%
          </span>
        </div>
        <Slider
          id="confidence-slider"
          min={0}
          max={1}
          step={0.01}
          value={[confidenceValue]}
          onValueChange={handleConfidenceChange}
          className="w-full"
        />
      </div>

      {/* Time Range Slider */}
      {maxDuration && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="time-range-slider" className="text-sm font-medium">
              Time Range
            </Label>
            <span className="text-sm text-muted-foreground">
              {formatTime(timeRangeValues[0])} -{' '}
              {formatTime(timeRangeValues[1])}
            </span>
          </div>
          <Slider
            id="time-range-slider"
            min={0}
            max={maxDuration}
            step={0.1}
            value={timeRangeValues}
            onValueChange={handleTimeRangeChange}
            className="w-full"
          />
        </div>
      )}
    </div>
  );
}
