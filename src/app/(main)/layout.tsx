'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { Menu } from '@headlessui/react';
import { Bars3Icon } from '@heroicons/react/24/outline';
import type { Session } from '@supabase/supabase-js';

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [inputValue, setInputValue] = useState('');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isHome = pathname === '/';
  const initializedRef = useRef(false);

  // Session
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  // Sync inputValue from URL only on home page mount
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      setInputValue(searchParams?.get('q') || '');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounce: update URL when inputValue changes
  useEffect(() => {
    const handler = setTimeout(() => {
      const current = searchParams?.get('q') || '';
      if (inputValue === current && isHome) return;
      const params = new URLSearchParams(isHome ? Array.from(searchParams?.entries() || []) : []);
      if (inputValue) params.set('q', inputValue);
      else params.delete('q');
      const target = `/?${params.toString()}`;
      if (isHome) router.replace(target, { scroll: false });
      else router.push(target, { scroll: false });
    }, 250);
    return () => clearTimeout(handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputValue]);

  const showOnlyStarred = searchParams?.get('starred') === '1';
  const showOnlyMine = searchParams?.get('mine') === '1';

  const toggleParam = (key: string, current: boolean) => {
    const params = new URLSearchParams(isHome ? Array.from(searchParams?.entries() || []) : []);
    if (current) params.delete(key);
    else params.set(key, '1');
    if (isHome) router.replace(`/?${params.toString()}`, { scroll: false });
    else router.push(`/?${params.toString()}`, { scroll: false });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setSession(null);
    router.push('/');
  };

  return (
    <main className="container mx-auto px-4 md:px-8 max-w-4xl font-sans">
      {/* ── Sticky header + search ──────────────────────────────── */}
      <div className="sticky top-0 z-30 bg-gray-100/90 backdrop-blur-sm pt-6 pb-3">
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4">
        <Link href="/" legacyBehavior>
          <a className="group cursor-pointer" style={{ textDecoration: 'none' }}>
            <p className="text-xs text-gray-400 font-medium uppercase tracking-widest mb-0.5 group-hover:text-gray-600 transition-colors">Medical Notes</p>
            <h1 className="text-2xl font-bold text-gray-900 leading-none">{session ? 'Your Posts' : 'All Posts'}</h1>
          </a>
        </Link>

        {/* Desktop nav */}
        <div className="hidden sm:flex items-center gap-2">
          {session && (
            <>
              <Link href="/posts/new" legacyBehavior>
                <a className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold shadow-sm hover:bg-blue-700 transition-colors">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  New Post
                </a>
              </Link>
              <div className="flex items-center gap-0 border border-gray-200 rounded-lg bg-white shadow-sm divide-x divide-gray-200">
                <Link href="/quiz" legacyBehavior>
                  <a className="inline-flex items-center justify-center px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors rounded-l-lg">
                    Quiz
                  </a>
                </Link>
                <button
                  onClick={() => toggleParam('starred', showOnlyStarred)}
                  className={`inline-flex items-center justify-center px-3 py-1.5 text-sm font-medium transition-colors ${
                    showOnlyStarred ? 'bg-yellow-50 text-yellow-700' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {showOnlyStarred ? '★ Starred ✓' : '★ Starred'}
                </button>
                <Menu as="div" className="relative">
                  <Menu.Button className="inline-flex items-center justify-center px-2.5 py-1.5 text-gray-500 hover:bg-gray-50 transition-colors rounded-r-lg focus:outline-none">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <circle cx="12" cy="8" r="4" />
                      <path strokeLinecap="round" d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                    </svg>
                  </Menu.Button>
                  <Menu.Items className="origin-top-right absolute right-0 mt-2 w-52 rounded-xl shadow-lg bg-white ring-1 ring-black ring-opacity-5 focus:outline-none z-50 py-1">
                    <Menu.Item>
                      {({ active }: { active: boolean }) => (
                        <button
                          onClick={() => toggleParam('mine', showOnlyMine)}
                          className={`w-full text-left px-4 py-2 text-sm flex items-center justify-between ${active ? 'bg-gray-50' : ''} text-gray-700`}
                        >
                          My Posts
                          {showOnlyMine && <span className="text-blue-600 text-xs font-semibold">✓</span>}
                        </button>
                      )}
                    </Menu.Item>
                    <Menu.Item>
                      {({ active }: { active: boolean }) => (
                        <Link href="/settings" legacyBehavior>
                          <a className={`block px-4 py-2 text-sm text-gray-700 ${active ? 'bg-gray-50' : ''}`}>Settings</a>
                        </Link>
                      )}
                    </Menu.Item>
                    <Menu.Item>
                      {({ active }: { active: boolean }) => (
                        <Link href="/integrations" legacyBehavior>
                          <a className={`block px-4 py-2 text-sm text-gray-700 ${active ? 'bg-gray-50' : ''}`}>API</a>
                        </Link>
                      )}
                    </Menu.Item>
                    <div className="border-t border-gray-100 my-1" />
                    <Menu.Item>
                      {({ active }: { active: boolean }) => (
                        <button
                          onClick={handleLogout}
                          className={`w-full text-left px-4 py-2 text-sm text-red-600 ${active ? 'bg-red-50' : ''}`}
                        >
                          Logout{session?.user?.email ? ` (${session.user.email.split('@')[0]})` : ''}
                        </button>
                      )}
                    </Menu.Item>
                  </Menu.Items>
                </Menu>
              </div>
            </>
          )}
          {!session && (
            <Link href="/login" legacyBehavior>
              <a className="inline-flex items-center justify-center px-4 py-2 rounded-lg border border-blue-600 bg-blue-100 text-blue-700 hover:bg-blue-200 text-sm font-medium transition-colors">
                Login / Sign Up
              </a>
            </Link>
          )}
        </div>

        {/* Mobile hamburger */}
        <div className="sm:hidden">
          <Menu as="div" className="relative inline-block text-left">
            <Menu.Button className="inline-flex items-center justify-center p-2 rounded-md text-gray-700 hover:bg-gray-200 focus:outline-none">
              <Bars3Icon className="h-6 w-6" />
            </Menu.Button>
            <Menu.Items className="origin-top-right absolute right-0 mt-2 w-52 rounded-xl shadow-lg bg-white ring-1 ring-black ring-opacity-5 focus:outline-none z-50 py-1">
              {session && (
                <>
                  <Menu.Item>
                    {({ active }: { active: boolean }) => (
                      <Link href="/posts/new" legacyBehavior>
                        <a className={`block px-4 py-2 text-sm font-semibold ${active ? 'bg-blue-50 text-blue-900' : 'text-blue-700'}`}>+ New Post</a>
                      </Link>
                    )}
                  </Menu.Item>
                  <Menu.Item>
                    {({ active }: { active: boolean }) => (
                      <Link href="/quiz" legacyBehavior>
                        <a className={`block px-4 py-2 text-sm ${active ? 'bg-gray-100 text-gray-900' : 'text-gray-700'}`}>Quiz</a>
                      </Link>
                    )}
                  </Menu.Item>
                  <Menu.Item>
                    {({ active }: { active: boolean }) => (
                      <button
                        onClick={() => toggleParam('starred', showOnlyStarred)}
                        className={`w-full text-left px-4 py-2 text-sm ${showOnlyStarred ? 'bg-yellow-50 text-yellow-900' : active ? 'bg-gray-100 text-gray-900' : 'text-gray-700'}`}
                      >
                        {showOnlyStarred ? '★ Starred ✓' : '★ Starred'}
                      </button>
                    )}
                  </Menu.Item>
                  <Menu.Item>
                    {({ active }: { active: boolean }) => (
                      <button
                        onClick={() => toggleParam('mine', showOnlyMine)}
                        className={`w-full text-left px-4 py-2 text-sm ${showOnlyMine ? 'bg-yellow-50 text-yellow-900' : active ? 'bg-gray-100 text-gray-900' : 'text-gray-700'}`}
                      >
                        {showOnlyMine ? 'My Posts ✓' : 'My Posts'}
                      </button>
                    )}
                  </Menu.Item>
                  <Menu.Item>
                    {({ active }: { active: boolean }) => (
                      <Link href="/settings" legacyBehavior>
                        <a className={`block px-4 py-2 text-sm ${active ? 'bg-gray-100 text-gray-900' : 'text-gray-700'}`}>Settings</a>
                      </Link>
                    )}
                  </Menu.Item>
                  <div className="border-t border-gray-100 my-1" />
                  <Menu.Item>
                    {({ active }: { active: boolean }) => (
                      <button
                        onClick={handleLogout}
                        className={`w-full text-left px-4 py-2 text-sm text-red-600 ${active ? 'bg-red-50' : ''}`}
                      >
                        Logout{session?.user?.email ? ` (${session.user.email.split('@')[0]})` : ''}
                      </button>
                    )}
                  </Menu.Item>
                </>
              )}
              {!session && (
                <Menu.Item>
                  {({ active }: { active: boolean }) => (
                    <Link href="/login" legacyBehavior>
                      <a className={`block px-4 py-2 text-sm ${active ? 'bg-blue-100 text-blue-900' : 'text-blue-700'}`}>Login / Sign Up</a>
                    </Link>
                  )}
                </Menu.Item>
              )}
            </Menu.Items>
          </Menu>
        </div>
      </div>

      {/* ── Search bar ──────────────────────────────────────────── */}
      <div className="mb-5 relative">
        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0Z" />
        </svg>
        <input
          type="search"
          placeholder="Search posts by content or tags..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          className="block w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm text-gray-900 placeholder-gray-400"
        />
      </div>
      </div>{/* end sticky */}

      {/* ── Page content ────────────────────────────────────────── */}
      <div className="pb-8">
        {children}
      </div>
    </main>
  );
}
