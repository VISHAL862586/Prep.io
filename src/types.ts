export type ProblemStatus = 'Solved' | 'Unsolved' | 'Revising';

export interface Problem {
  id: string;
  uid: string;
  title: string;
  topic: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  status: ProblemStatus;
  dateAdded: string;
  link?: string;
}

export interface Note {
  id: string;
  uid: string;
  title: string;
  content: string;
  date: string;
}

export interface UserProfile {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  streak: number;
  lastSolvedDate: string | null;
}

export interface UserData {
  problems: Problem[];
  notes: Note[];
  profile: UserProfile | null;
}

export const TOPICS = [
  'Arrays',
  'Strings',
  'Linked List',
  'Trees',
  'Graphs',
  'Dynamic Programming',
  'Recursion',
  'Sorting & Searching',
  'Bit Manipulation',
  'Heaps',
  'Stacks & Queues',
];
