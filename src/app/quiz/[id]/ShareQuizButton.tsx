"use client";

export default function ShareQuizButton() {
  return (
    <button
      className="mb-6 px-3 py-1 rounded border border-blue-600 bg-blue-100 text-blue-700 hover:bg-blue-200 text-xs font-medium"
      onClick={() => navigator.clipboard.writeText(window.location.href)}
    >
      Share Quiz Link
    </button>
  );
} 