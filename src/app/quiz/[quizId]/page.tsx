import { notFound } from 'next/navigation';
// import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import ShareQuizButtonWrapper from './ShareQuizButtonWrapper';
import dynamic from 'next/dynamic';

const ClientQuizDisplay = dynamic(() => import('./ClientQuizDisplay'), { ssr: false });

// Removed unused QuizQuestion type

// type Quiz = {
//   id: string;
//   questions: QuizQuestion[];
//   range_from: string;
//   range_to: string;
// };

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