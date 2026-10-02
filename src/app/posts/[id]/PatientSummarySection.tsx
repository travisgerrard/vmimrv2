import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface PatientSummarySectionProps {
  patientSummary: { id: string; summary: string } | null;
  patientSummaryLoading: boolean;
  patientSummaryError: string | null;
  feedback: string;
  setFeedback: (val: string) => void;
  handleGeneratePatientSummary: (feedback?: string) => void;
  canManagePatientSummary: boolean;
  post: { tags: string[] | null };
}

const PatientSummarySection: React.FC<PatientSummarySectionProps> = ({
  patientSummary,
  patientSummaryLoading,
  patientSummaryError,
  feedback,
  setFeedback,
  handleGeneratePatientSummary,
  canManagePatientSummary,
  post,
}) => {
  if (!post.tags || !post.tags.includes('patient')) return null;
  if (!canManagePatientSummary && !patientSummary && !patientSummaryLoading && !patientSummaryError) return null;
  return (
    <div className="mb-6">
      <h3 className="font-semibold text-green-700 mb-2">Patient-Friendly Summary</h3>
      {patientSummaryError && (
        <div role="alert" className="mb-3 p-4 border-l-4 border-red-300 bg-red-50 rounded text-sm text-red-700">{patientSummaryError}</div>
      )}
      {patientSummaryLoading && (
        <div className="p-4 border-l-4 border-green-300 bg-green-50 rounded text-sm text-green-700">Loading patient-friendly summary...</div>
      )}
      {patientSummary && !patientSummaryLoading && (
        <div>
          <div className="p-4 border-l-4 border-green-300 bg-green-50 rounded mb-2">
            <div className="text-sm text-gray-800 prose prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {patientSummary.summary}
              </ReactMarkdown>
            </div>
          </div>
          {canManagePatientSummary && <div className="flex flex-col gap-2 mt-2">
            <textarea
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              placeholder="Optional: Give feedback or instructions to improve the summary (e.g., 'simplify more', 'focus on diet advice')"
              value={feedback}
              onChange={e => setFeedback(e.target.value)}
              rows={2}
              disabled={patientSummaryLoading}
            />
            <button
              className="px-4 py-2 rounded border border-green-600 bg-green-500 text-white hover:bg-green-600 text-sm font-medium transition-colors disabled:opacity-50"
              onClick={() => handleGeneratePatientSummary(feedback)}
              disabled={patientSummaryLoading}
            >
              Regenerate with Feedback
            </button>
          </div>}
        </div>
      )}
      {canManagePatientSummary && !patientSummary && !patientSummaryLoading && (
        <button
          className="px-4 py-2 rounded border border-green-600 bg-green-500 text-white hover:bg-green-600 text-sm font-medium transition-colors disabled:opacity-50 w-full"
          onClick={() => handleGeneratePatientSummary('')}
          disabled={patientSummaryLoading}
        >
          Generate Patient-Friendly Summary
        </button>
      )}
    </div>
  );
};

export default PatientSummarySection;
