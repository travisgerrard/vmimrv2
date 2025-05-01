import { notFound } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import ShareQuizButtonWrapper from './ShareQuizButtonWrapper';

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
      <QuizDisplay quiz={quiz} />
    </main>
  );
}

function QuizDisplay({ quiz }: { quiz: Quiz }) {
  if (!quiz.questions) return null;
  return (
    <div>
      {quiz.questions.map((q: QuizQuestion, idx: number) => (
        <div key={idx} className="mb-6">
          <div className="font-medium mb-2">{idx + 1}. {q.question}</div>
          <ul className="list-disc ml-6">
            {q.choices.map((choice: string, cidx: number) => (
              <li key={cidx}>{choice}</li>
            ))}
          </ul>
          <div className="text-xs text-gray-500 mt-1">Correct: {q.correct}</div>
          <div className="mt-1">
            <Link href={`/posts/${q.noteId}`} className="text-blue-600 hover:underline text-xs">View Source Note</Link>
          </div>
        </div>
      ))}
    </div>
  );
} 