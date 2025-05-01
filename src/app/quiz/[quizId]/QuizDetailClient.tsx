"use client";
import ClientQuizDisplay from './ClientQuizDisplay';

type QuizQuestion = {
  question: string;
  choices: string[];
  correct: string;
  noteId: string;
};

type Quiz = {
  id: string;
  questions: QuizQuestion[];
  range_from: string;
  range_to: string;
};

export default function QuizDetailClient({ quiz }: { quiz: Quiz }) {
  return <ClientQuizDisplay quiz={quiz} />;
} 