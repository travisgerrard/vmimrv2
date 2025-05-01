"use client";
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Link from 'next/link';
import { format, subDays } from 'date-fns';

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

export default function QuizPage() {
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quizRange, setQuizRange] = useState<{from: string, to: string}>(() => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const weekAgo = format(subDays(new Date(), 7), 'yyyy-MM-dd');
    return { from: weekAgo, to: today };
  });
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [numQuestions, setNumQuestions] = useState(8);

  // Fetch quizzes on mount
  useEffect(() => {
    async function fetchQuizzes() {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase
        .from('quizzes')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) setError(error.message);
      else setQuizzes((data as Quiz[]) || []);
      setLoading(false);
    }
    fetchQuizzes();
  }, []);

  // Generate new quiz
  async function handleGenerateQuiz() {
    setGenerating(true);
    setGenError(null);
    try {
      // Fetch notes in range
      const { data: notes, error } = await supabase
        .from('posts')
        .select('id, content, created_at')
        .gte('created_at', quizRange.from)
        .lte('created_at', quizRange.to)
        .order('created_at', { ascending: false });
      if (error) throw error;
      if (!notes || notes.length === 0) {
        setGenError('No notes found in selected range.');
        setGenerating(false);
        return;
      }
      // Call API to generate quiz
      const res = await fetch('/api/generate-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes, numQuestions }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to generate quiz');
      // Save quiz to Supabase
      const { data: quiz, error: saveError } = await supabase
        .from('quizzes')
        .insert({
          user_id: (await supabase.auth.getUser()).data.user?.id,
          questions: json.questions,
          range_from: quizRange.from,
          range_to: quizRange.to,
        })
        .select('*')
        .single();
      if (saveError) throw saveError;
      // Prepend new quiz to list
      setQuizzes(qs => [quiz, ...qs]);
    } catch (e: unknown) {
      if (e instanceof Error) setGenError(e.message || 'Failed to generate quiz');
      else setGenError('Failed to generate quiz');
    } finally {
      setGenerating(false);
    }
  }

  const mostRecentQuiz = quizzes[0];
  const oldQuizzes = quizzes.slice(1);

  return (
    <main className="container mx-auto p-4 md:p-8 font-sans">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/" className="inline-flex items-center px-4 py-2 rounded border border-gray-300 bg-gray-50 text-gray-700 hover:bg-gray-100 text-sm font-medium transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
          &larr; Back to Main Page
        </Link>
        <h1 className="text-3xl font-bold text-gray-900 mb-0">Quiz Dashboard</h1>
      </div>
      {/* Quiz Generation Controls */}
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">From</label>
          <input type="date" value={quizRange.from} onChange={e => setQuizRange(r => ({ ...r, from: e.target.value }))} className="border rounded px-2 py-1" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">To</label>
          <input type="date" value={quizRange.to} onChange={e => setQuizRange(r => ({ ...r, to: e.target.value }))} className="border rounded px-2 py-1" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Number of Questions</label>
          <input
            type="number"
            min={1}
            max={50}
            value={numQuestions}
            onChange={e => setNumQuestions(Number(e.target.value))}
            className="border rounded px-2 py-1 w-24"
          />
        </div>
        <button
          onClick={handleGenerateQuiz}
          className="px-4 py-2 rounded border border-blue-600 bg-blue-500 text-white hover:bg-blue-600 text-sm font-medium transition-colors shadow-sm"
          disabled={generating}
        >
          {generating ? 'Generating Quiz...' : 'Generate Quiz'}
        </button>
      </div>
      {genError && <div className="text-red-600 mb-4">{genError}</div>}
      {/* Most Recent Quiz */}
      {mostRecentQuiz && (
        <div className="mb-8 p-4 border rounded bg-white shadow">
          <h2 className="text-lg font-bold mb-4">Most Recent Quiz</h2>
          <QuizDisplay quiz={mostRecentQuiz} />
          <div className="mt-2">
            <Link href={`/quiz/${mostRecentQuiz.id}`} className="text-blue-600 hover:underline text-xs">Share / View Full Quiz</Link>
          </div>
        </div>
      )}
      {/* Quiz History */}
      <h3 className="text-md font-semibold mb-2">Quiz History</h3>
      <ul className="space-y-2">
        {oldQuizzes.map(q => (
          <li key={q.id}>
            <Link href={`/quiz/${q.id}`} className="text-blue-600 hover:underline">
              Quiz from {q.range_from} to {q.range_to} ({q.questions.length} questions)
            </Link>
          </li>
        ))}
      </ul>
      {loading && <div className="text-gray-500 mt-4">Loading quizzes...</div>}
      {error && <div className="text-red-600 mt-4">{error}</div>}
    </main>
  );
}

// QuizDisplay component (scaffold)
function QuizDisplay({ quiz }: { quiz: Quiz }) {
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