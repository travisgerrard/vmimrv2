import { notFound } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import ShareQuizButtonWrapper from './ShareQuizButtonWrapper';
import { useState } from 'react';

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

export default async function QuizDetailPage({ params }: { params: Promise<{ quizId: string }> }) {
  const { quizId } = await params;
  const { data: quiz, error } = await supabase
    .from('quizzes')
    .select('*')
    .eq('id', quizId)
    .single();

  if (error || !quiz) return notFound();

  return (
    <main className="container mx-auto p-4 md:p-8 font-sans">
      <h1 className="text-2xl font-bold mb-4 text-gray-900">Quiz</h1>
      <div className="mb-2 text-sm text-gray-500">
        Date range: {quiz.range_from} to {quiz.range_to}
      </div>
      <ShareQuizButtonWrapper />
      <ClientQuizDisplay quiz={quiz} />
    </main>
  );
}

// Client component for interactivity
function ClientQuizDisplay({ quiz }: { quiz: Quiz }) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  return (
    <div>
      {quiz.questions.map((q: QuizQuestion, idx: number) => {
        const selected = answers[idx];
        const isCorrect = selected === q.correct;
        return (
          <div key={idx} className="mb-6">
            <div className="font-medium mb-2">{idx + 1}. {q.question}</div>
            <div className="space-y-1">
              {q.choices.map((choice: string, cidx: number) => (
                <label key={cidx} className="block cursor-pointer">
                  <input
                    type="radio"
                    name={`q${idx}`}
                    value={choice}
                    checked={selected === choice}
                    onChange={() => setAnswers(a => ({ ...a, [idx]: choice }))}
                    disabled={selected !== undefined}
                    className="mr-2"
                  />
                  {choice}
                </label>
              ))}
            </div>
            {selected !== undefined && (
              <div className={isCorrect ? 'text-green-600 mt-2' : 'text-red-600 mt-2'}>
                {isCorrect ? 'Correct!' : `Incorrect. Correct answer: ${q.correct}`}
              </div>
            )}
            <div className="mt-1">
              <Link href={`/posts/${q.noteId}`} className="text-blue-600 hover:underline text-xs" target="_blank" rel="noopener noreferrer">View Source Note</Link>
            </div>
          </div>
        );
      })}
    </div>
  );
} 