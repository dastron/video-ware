'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTimeline } from '@/hooks/use-timeline';
import { Trash2, Clock, Palette, Type } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface ClipEditModalProps {
  clipId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PRESET_COLORS = [
  { name: 'Blue', value: 'bg-blue-600' },
  { name: 'Indigo', value: 'bg-indigo-600' },
  { name: 'Violet', value: 'bg-violet-600' },
  { name: 'Purple', value: 'bg-purple-600' },
  { name: 'Pink', value: 'bg-pink-600' },
  { name: 'Rose', value: 'bg-rose-600' },
  { name: 'Red', value: 'bg-red-600' },
  { name: 'Orange', value: 'bg-orange-600' },
  { name: 'Amber', value: 'bg-amber-600' },
  { name: 'Yellow', value: 'bg-yellow-500' },
  { name: 'Lime', value: 'bg-lime-600' },
  { name: 'Green', value: 'bg-green-600' },
  { name: 'Emerald', value: 'bg-emerald-600' },
  { name: 'Teal', value: 'bg-teal-600' },
  { name: 'Cyan', value: 'bg-cyan-600' },
  { name: 'Sky', value: 'bg-sky-600' },
];

export function ClipEditModal({
  clipId,
  open,
  onOpenChange,
}: ClipEditModalProps) {
  const { timeline, updateClip, removeClip } = useTimeline();
  const clip = timeline?.clips.find((c) => c.id === clipId);

  const [title, setTitle] = useState('');
  const [color, setColor] = useState('');
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [isSaving, setIsSaving] = useState(false);

  // Reset state when clip changes
  useEffect(() => {
    if (clip) {
      setTitle(clip.meta?.title || '');
      setColor(clip.meta?.color || 'bg-blue-600');
      setStart(clip.start);
      setEnd(clip.end);
    }
  }, [clip]);

  if (!clip) return null;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateClip(clip.id, {
        start,
        end,
        meta: {
          ...clip.meta,
          title,
          color,
        },
      });
      toast.success('Clip updated');
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to update clip:', error);
      toast.error('Failed to update clip');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (
      confirm('Are you sure you want to remove this clip from the timeline?')
    ) {
      try {
        await removeClip(clip.id);
        toast.success('Clip removed');
        onOpenChange(false);
      } catch (error) {
        console.error('Failed to remove clip:', error);
        toast.error('Failed to remove clip');
      }
    }
  };

  const mediaName =
    (clip as any).expand?.MediaRef?.expand?.UploadRef?.name || 'Clip';
  const duration = end - start;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className={cn('w-3 h-3 rounded-full', color)} />
            Edit Clip
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-6 py-4">
          {/* Title Section */}
          <div className="grid gap-2">
            <Label htmlFor="title" className="flex items-center gap-2">
              <Type className="w-4 h-4" />
              Display Name
            </Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={mediaName}
            />
            <p className="text-[10px] text-muted-foreground">
              Sets a custom name for this clip on the timeline.
            </p>
          </div>

          {/* Color Section */}
          <div className="grid gap-3">
            <Label className="flex items-center gap-2">
              <Palette className="w-4 h-4" />
              Clip Color
            </Label>
            <div className="grid grid-cols-8 gap-2">
              {PRESET_COLORS.map((pc) => (
                <button
                  key={pc.value}
                  className={cn(
                    'w-full aspect-square rounded-md border-2 transition-all',
                    pc.value,
                    color === pc.value
                      ? 'border-white ring-2 ring-primary ring-offset-1'
                      : 'border-transparent hover:scale-110'
                  )}
                  onClick={() => setColor(pc.value)}
                  title={pc.name}
                />
              ))}
            </div>
          </div>

          {/* Timing Section */}
          <div className="grid gap-4">
            <Label className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Clip Timing
            </Label>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label
                  htmlFor="start"
                  className="text-xs text-muted-foreground font-normal"
                >
                  Start (s)
                </Label>
                <Input
                  id="start"
                  type="number"
                  step="0.1"
                  value={start}
                  onChange={(e) => setStart(parseFloat(e.target.value))}
                  className="h-8"
                />
              </div>
              <div className="grid gap-1.5">
                <Label
                  htmlFor="end"
                  className="text-xs text-muted-foreground font-normal"
                >
                  End (s)
                </Label>
                <Input
                  id="end"
                  type="number"
                  step="0.1"
                  value={end}
                  onChange={(e) => setEnd(parseFloat(e.target.value))}
                  className="h-8"
                />
              </div>
            </div>
            <div className="px-3 py-2 rounded-md bg-muted/50 flex justify-between items-center">
              <span className="text-xs font-medium">Resulting Duration:</span>
              <span className="text-xs font-mono font-bold text-primary">
                {duration.toFixed(2)}s
              </span>
            </div>
          </div>
        </div>

        <DialogFooter className="flex justify-between sm:justify-between items-center mt-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={handleDelete}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Remove
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
