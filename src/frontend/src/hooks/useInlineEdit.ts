import { useCallback, useState } from "react";

export interface UseInlineEditOptions<T> {
  onSave: (item: T) => Promise<void>;
  onCancel?: () => void;
  /** User-visible message when save fails (i18n). */
  saveErrorMessage: string;
}

export function useInlineEdit<T extends { id: string | number }>(
  options: UseInlineEditOptions<T>,
) {
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [editingData, setEditingData] = useState<Partial<T>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { onSave, onCancel, saveErrorMessage } = options;

  const startEdit = useCallback((item: T) => {
    setEditingId(item.id);
    setEditingData({ ...item });
    setSaveError(null);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditingData({});
    setSaveError(null);
    onCancel?.();
  }, [onCancel]);

  const updateField = useCallback((field: keyof T, value: T[keyof T]) => {
    setEditingData((prev) => ({ ...prev, [field]: value }));
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingId) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(editingData as T);
      setEditingId(null);
      setEditingData({});
    } catch {
      setSaveError(saveErrorMessage);
    } finally {
      setSaving(false);
    }
  }, [editingId, editingData, onSave, saveErrorMessage]);

  const isEditing = useCallback(
    (id: string | number) => editingId === id,
    [editingId],
  );

  return {
    editingId,
    editingData,
    saving,
    saveError,
    startEdit,
    cancelEdit,
    updateField,
    saveEdit,
    isEditing,
  };
}
