import { notFound } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';

export default async function QuizDetailPage({ params }: { params: { id: string } }) {
  const { data: quiz, error } = await supabase
    .from('quizzes')
    .select('*')
    .eq('id', params.id)
    .single();

  if (error || !quiz) return notFound();

  return (
    <main className="container mx-auto p-4 md:p-8 font-sans">
      <h1 className="text-2xl font-bold mb-4 text-gray-900">Quiz</h1>
      <div className="mb-2 text-sm text-gray-500">
        Date range: {quiz.range_from} to {quiz.range_to}
      </div>
      <button
        className="mb-6 px-3 py-1 rounded border border-blue-600 bg-blue-100 text-blue-700 hover:bg-blue-200 text-xs font-medium"
        onClick={() => navigator.clipboard.writeText(window.location.href)}
      >
        Share Quiz Link
      </button>
      <QuizDisplay quiz={quiz} />
    </main>
  );
}

function QuizDisplay({ quiz }: { quiz: any }) {
  if (!quiz.questions) return null;
  return (
    <div>
      {quiz.questions.map((q: any, idx: number) => (
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