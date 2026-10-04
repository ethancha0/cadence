"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import type { Priority } from "@/lib/types";

/** Shared state for the "add a task" forms on Plan and Tasks. */
export function useNewTask() {
  const { activeCategories, addTask } = useStore();
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [due, setDue] = useState("");

  // Fall back to the first category when none is chosen (or the chosen one was archived).
  const cid = activeCategories.some((c) => c.id === categoryId) ? categoryId : activeCategories[0]?.id ?? "";
  const canAdd = Boolean(title.trim() && cid);

  const submit = () => {
    if (!canAdd) return;
    addTask({ title: title.trim(), category_id: cid, priority, due_date: due || null });
    setTitle("");
    setDue("");
  };

  return { title, setTitle, cid, setCategoryId, priority, setPriority, due, setDue, canAdd, submit, categories: activeCategories };
}
