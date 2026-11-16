"use client";

import { useSyncExternalStore } from "react";
import type { Draw, Person, Rule } from "./draw";

export type State = {
  eventName: string;
  budget: string;
  date: string;
  people: Person[];
  rules: Rule[];
  draw: Draw | null;
  opened: string[];
};

const KEY = "secret-santa:v1";

export const initialState: State = {
  eventName: "Secret Santa 2026",
  budget: "₹1,000",
  date: "",
  people: [],
  rules: [],
  draw: null,
  opened: [],
};

let state: State | null = null;
const listeners = new Set<() => void>();

function load(): State {
  if (state) return state;
  try {
    const raw = window.localStorage.getItem(KEY);
    state = raw ? { ...initialState, ...JSON.parse(raw) } : initialState;
  } catch {
    state = initialState;
  }
  return state!;
}

export function setState(update: Partial<State> | ((s: State) => Partial<State>)) {
  const current = load();
  const patch = typeof update === "function" ? update(current) : update;
  state = { ...current, ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: keep working in memory */
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStore(): State {
  return useSyncExternalStore(subscribe, load, () => initialState);
}

export function newId() {
  return Math.random().toString(36).slice(2, 10);
}
