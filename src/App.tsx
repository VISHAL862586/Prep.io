/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  LayoutDashboard, 
  BookOpen, 
  CheckCircle2, 
  Clock, 
  Flame, 
  Plus, 
  Search, 
  Trash2, 
  ExternalLink,
  ChevronRight,
  BarChart3,
  StickyNote,
  Filter,
  LogOut,
  User,
  LogIn,
  UserPlus,
  AlertCircle
} from 'lucide-react';
import { 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area,
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import { format, subDays, isSameDay, parseISO } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { Problem, ProblemStatus, Note, UserData, TOPICS, UserProfile } from './types';
import { auth, db } from './firebase';
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  collection, 
  doc, 
  setDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  deleteDoc,
  updateDoc,
  getDoc,
  getDocFromServer
} from 'firebase/firestore';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const INITIAL_DATA: UserData = {
  problems: [],
  notes: [],
  profile: null,
};

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authError, setAuthError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [data, setData] = useState<UserData>(INITIAL_DATA);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'problems' | 'notes' | 'profile'>('dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTopic, setFilterTopic] = useState<string>('All');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
      if (!u) {
        setData(INITIAL_DATA);
      }
    });
    return unsubscribe;
  }, []);

  // Firestore Sync
  useEffect(() => {
    if (!user || !isAuthReady) return;

    // Test connection
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error: any) {
        if (error.message?.includes('the client is offline')) {
          setOperationError("Firestore is offline. Please check your internet connection and Firebase configuration.");
        }
      }
    };
    testConnection();

    const userRef = doc(db, 'users', user.uid);
    
    // Sync Profile
    const unsubProfile = onSnapshot(userRef, (docSnap) => {
      if (docSnap.exists()) {
        setData(prev => ({ ...prev, profile: docSnap.data() as UserProfile }));
      } else {
        // Initialize profile if it doesn't exist
        const newProfile: UserProfile = {
          uid: user.uid,
          displayName: user.displayName || 'Student',
          email: user.email,
          photoURL: user.photoURL,
          streak: 0,
          lastSolvedDate: null
        };
        setDoc(userRef, newProfile).catch(e => handleFirestoreError(e, OperationType.WRITE, `users/${user.uid}`));
      }
    }, (e) => handleFirestoreError(e, OperationType.GET, `users/${user.uid}`));

    // Sync Problems
    const problemsQuery = query(collection(db, 'users', user.uid, 'problems'), orderBy('dateAdded', 'desc'));
    const unsubProblems = onSnapshot(problemsQuery, (snap) => {
      const problems = snap.docs.map(d => d.data() as Problem);
      setData(prev => ({ ...prev, problems }));
    }, (e) => handleFirestoreError(e, OperationType.GET, `users/${user.uid}/problems`));

    // Sync Notes
    const notesQuery = query(collection(db, 'users', user.uid, 'notes'), orderBy('date', 'desc'));
    const unsubNotes = onSnapshot(notesQuery, (snap) => {
      const notes = snap.docs.map(d => d.data() as Note);
      setData(prev => ({ ...prev, notes }));
    }, (e) => handleFirestoreError(e, OperationType.GET, `users/${user.uid}/notes`));

    return () => {
      unsubProfile();
      unsubProblems();
      unsubNotes();
    };
  }, [user, isAuthReady]);

  // Calculate Streak logic (moved to server-side or handled during problem add)
  // For now, we'll keep it simple and update it when a problem is solved.

  const stats = useMemo(() => {
    const total = data.problems.length;
    const solved = data.problems.filter(p => p.status === 'Solved').length;
    const revising = data.problems.filter(p => p.status === 'Revising').length;
    const unsolved = data.problems.filter(p => p.status === 'Unsolved').length;
    const easy = data.problems.filter(p => p.difficulty === 'Easy' && p.status === 'Solved').length;
    const medium = data.problems.filter(p => p.difficulty === 'Medium' && p.status === 'Solved').length;
    const hard = data.problems.filter(p => p.difficulty === 'Hard' && p.status === 'Solved').length;

    return { total, solved, revising, unsolved, easy, medium, hard };
  }, [data.problems]);

  const chartData = useMemo(() => {
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const date = subDays(new Date(), 6 - i);
      const formattedDate = format(date, 'MMM dd');
      const count = data.problems.filter(p => 
        p.status === 'Solved' && isSameDay(parseISO(p.dateAdded), date)
      ).length;
      return { name: formattedDate, count };
    });
    return last7Days;
  }, [data.problems]);

  const topicProgress = useMemo(() => {
    return TOPICS.map(topic => {
      const topicProblems = data.problems.filter(p => p.topic === topic);
      const solved = topicProblems.filter(p => p.status === 'Solved').length;
      const total = topicProblems.length;
      return {
        topic,
        solved,
        total,
        percentage: total === 0 ? 0 : Math.round((solved / total) * 100)
      };
    }).sort((a, b) => b.percentage - a.percentage);
  }, [data.problems]);

  const filteredProblems = useMemo(() => {
    return data.problems.filter(p => {
      const matchesSearch = p.title.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesTopic = filterTopic === 'All' || p.topic === filterTopic;
      return matchesSearch && matchesTopic;
    }).sort((a, b) => new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime());
  }, [data.problems, searchQuery, filterTopic]);

  const addProblem = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;
    setOperationError(null);

    const formData = new FormData(e.currentTarget);
    const problemId = typeof crypto.randomUUID === 'function' 
      ? crypto.randomUUID() 
      : Math.random().toString(36).substring(2) + Date.now().toString(36);
    
    const link = formData.get('link') as string;
    const newProblem: Problem = {
      id: problemId,
      uid: user.uid,
      title: formData.get('title') as string,
      topic: formData.get('topic') as string,
      difficulty: formData.get('difficulty') as any,
      status: formData.get('status') as any,
      dateAdded: new Date().toISOString(),
      ...(link ? { link } : {})
    };

    try {
      await setDoc(doc(db, 'users', user.uid, 'problems', problemId), newProblem);
      
      if (newProblem.status === 'Solved') {
        const profileRef = doc(db, 'users', user.uid);
        const today = new Date();
        const todayStr = today.toISOString();
        
        let newStreak = data.profile?.streak || 0;
        let lastSolved = data.profile?.lastSolvedDate;

        if (!lastSolved || !isSameDay(parseISO(lastSolved), today)) {
          if (lastSolved && isSameDay(parseISO(lastSolved), subDays(today, 1))) {
            newStreak += 1;
          } else {
            newStreak = 1;
          }
          await setDoc(profileRef, { streak: newStreak, lastSolvedDate: todayStr }, { merge: true });
        }
      }
      setIsAddModalOpen(false);
    } catch (e: any) {
      setOperationError(e.message || 'Failed to add problem');
      console.error(e);
    }
  };

  const updateProblemStatus = async (id: string, status: ProblemStatus) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid, 'problems', id), { status });
      
      if (status === 'Solved') {
        const profileRef = doc(db, 'users', user.uid);
        const today = new Date();
        const todayStr = today.toISOString();
        
        let newStreak = data.profile?.streak || 0;
        let lastSolved = data.profile?.lastSolvedDate;

        if (!lastSolved || !isSameDay(parseISO(lastSolved), today)) {
          if (lastSolved && isSameDay(parseISO(lastSolved), subDays(today, 1))) {
            newStreak += 1;
          } else {
            newStreak = 1;
          }
          await updateDoc(profileRef, { streak: newStreak, lastSolvedDate: todayStr });
        }
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${user.uid}/problems/${id}`);
    }
  };

  const deleteProblem = async (id: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'problems', id));
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `users/${user.uid}/problems/${id}`);
    }
  };

  const addNote = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;

    const formData = new FormData(e.currentTarget);
    const noteId = typeof crypto.randomUUID === 'function' 
      ? crypto.randomUUID() 
      : Math.random().toString(36).substring(2) + Date.now().toString(36);
    const newNote: Note = {
      id: noteId,
      uid: user.uid,
      title: formData.get('title') as string,
      content: formData.get('content') as string,
      date: new Date().toISOString(),
    };

    try {
      await setDoc(doc(db, 'users', user.uid, 'notes', noteId), newNote);
      (e.target as HTMLFormElement).reset();
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `users/${user.uid}/notes/${noteId}`);
    }
  };

  const deleteNote = async (id: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'notes', id));
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `users/${user.uid}/notes/${id}`);
    }
  };

  const handleAuth = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setAuthError(null);
    const formData = new FormData(e.currentTarget);
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    const name = formData.get('name') as string;

    try {
      if (authMode === 'login') {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const userCred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCred.user, { displayName: name });
        // Profile doc is created by the useEffect listener
      }
    } catch (e: any) {
      setAuthError(e.message);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (e: any) {
      setAuthError(e.message);
    }
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-[#E4E3E0] flex items-center justify-center">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
          className="w-12 h-12 border-4 border-[#141414] border-t-transparent rounded-full"
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#E4E3E0] flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-white rounded-[40px] p-8 shadow-2xl border border-[#141414]/5"
        >
          <div className="flex items-center gap-3 mb-8 justify-center">
            <div className="w-10 h-10 bg-[#141414] rounded-xl flex items-center justify-center">
              <LayoutDashboard className="w-6 h-6 text-[#E4E3E0]" />
            </div>
            <span className="font-bold text-2xl tracking-tight">PREP.IO</span>
          </div>

          <h2 className="text-3xl font-bold mb-2 text-center italic font-serif">
            {authMode === 'login' ? 'Welcome Back' : 'Join the Journey'}
          </h2>
          <p className="text-sm opacity-50 text-center mb-8">
            {authMode === 'login' ? 'Sign in to continue your preparation' : 'Create an account to start tracking progress'}
          </p>

          {authError && (
            <div className="mb-6 p-4 bg-rose-50 text-rose-600 rounded-2xl flex items-center gap-3 text-sm font-medium">
              <AlertCircle className="w-5 h-5 shrink-0" />
              {authError}
            </div>
          )}

          <form onSubmit={handleAuth} className="space-y-4">
            {authMode === 'register' && (
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest opacity-40 block mb-1 ml-2">Full Name</label>
                <input 
                  name="name"
                  required
                  placeholder="John Doe"
                  className="w-full px-6 py-3 bg-[#E4E3E0]/50 rounded-2xl border-none focus:ring-2 focus:ring-[#141414]/10 font-bold"
                />
              </div>
            )}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest opacity-40 block mb-1 ml-2">Email Address</label>
              <input 
                name="email"
                type="email"
                required
                placeholder="student@example.com"
                className="w-full px-6 py-3 bg-[#E4E3E0]/50 rounded-2xl border-none focus:ring-2 focus:ring-[#141414]/10 font-bold"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest opacity-40 block mb-1 ml-2">Password</label>
              <input 
                name="password"
                type="password"
                required
                placeholder="••••••••"
                className="w-full px-6 py-3 bg-[#E4E3E0]/50 rounded-2xl border-none focus:ring-2 focus:ring-[#141414]/10 font-bold"
              />
            </div>
            <button className="w-full bg-[#141414] text-[#E4E3E0] py-4 rounded-2xl font-bold hover:opacity-90 transition-opacity flex items-center justify-center gap-2 mt-4">
              {authMode === 'login' ? <LogIn className="w-5 h-5" /> : <UserPlus className="w-5 h-5" />}
              {authMode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <div className="relative my-8">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[#141414]/10"></div>
            </div>
            <div className="relative flex justify-center text-[10px] uppercase font-bold tracking-widest">
              <span className="bg-white px-4 text-[#141414]/40">Or continue with</span>
            </div>
          </div>

          <button 
            onClick={handleGoogleSignIn}
            className="w-full bg-white text-[#141414] py-4 rounded-2xl font-bold border border-[#141414]/10 hover:bg-[#E4E3E0]/30 transition-colors flex items-center justify-center gap-3"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="currentColor"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="currentColor"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="currentColor"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Google
          </button>

          <div className="mt-8 pt-8 border-t border-[#141414]/5 text-center">
            <button 
              onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
              className="text-sm font-bold hover:opacity-60 transition-opacity"
            >
              {authMode === 'login' ? "Don't have an account? Register" : "Already have an account? Login"}
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414]">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 h-full w-20 md:w-64 bg-[#141414] text-[#E4E3E0] p-4 flex flex-col z-50">
        <div className="flex items-center gap-3 mb-12 px-2">
          <div className="w-10 h-10 bg-[#E4E3E0] rounded-xl flex items-center justify-center shrink-0">
            <LayoutDashboard className="w-6 h-6 text-[#141414]" />
          </div>
          <span className="font-bold text-xl tracking-tight hidden md:block">PREP.IO</span>
        </div>

        <nav className="flex-1 space-y-2">
          <SidebarLink 
            icon={LayoutDashboard} 
            label="Dashboard" 
            active={activeTab === 'dashboard'} 
            onClick={() => setActiveTab('dashboard')} 
          />
          <SidebarLink 
            icon={BookOpen} 
            label="Problems" 
            active={activeTab === 'problems'} 
            onClick={() => setActiveTab('problems')} 
          />
          <SidebarLink 
            icon={StickyNote} 
            label="Notes" 
            active={activeTab === 'notes'} 
            onClick={() => setActiveTab('notes')} 
          />
          <SidebarLink 
            icon={User} 
            label="Profile" 
            active={activeTab === 'profile'} 
            onClick={() => setActiveTab('profile')} 
          />
        </nav>

        <div className="mt-auto pt-6 border-t border-white/10">
          <button 
            onClick={() => signOut(auth)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl hover:bg-white/5 transition-colors text-rose-400 font-bold"
          >
            <LogOut className="w-5 h-5 shrink-0" />
            <span className="hidden md:block">Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="ml-20 md:ml-64 p-4 md:p-8 min-h-screen">
        <header className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tighter italic font-serif">
              {activeTab === 'dashboard' && 'Daily Progress'}
              {activeTab === 'problems' && 'Problem Bank'}
              {activeTab === 'notes' && 'Interview Notes'}
              {activeTab === 'profile' && 'My Profile'}
            </h1>
            <p className="text-sm opacity-60 mt-1">
              {format(new Date(), 'EEEE, MMMM do yyyy')}
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-full border border-[#141414]/10 shadow-sm">
              <Flame className="w-5 h-5 text-orange-500 fill-orange-500" />
              <span className="font-bold">{data.profile?.streak || 0} Day Streak</span>
            </div>
            <button 
              onClick={() => setIsAddModalOpen(true)}
              className="bg-[#141414] text-[#E4E3E0] px-6 py-2 rounded-full font-bold flex items-center gap-2 hover:scale-105 transition-transform"
            >
              <Plus className="w-5 h-5" />
              <span>Add Problem</span>
            </button>
          </div>
        </header>

        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              {/* Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard label="Total Solved" value={stats.solved} subValue={`${stats.total} total tracked`} icon={CheckCircle2} color="emerald" />
                <StatCard label="Easy" value={stats.easy} subValue="Solved" icon={BarChart3} color="blue" />
                <StatCard label="Medium" value={stats.medium} subValue="Solved" icon={BarChart3} color="orange" />
                <StatCard label="Hard" value={stats.hard} subValue="Solved" icon={BarChart3} color="rose" />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Activity Chart */}
                <div className="lg:col-span-2 bg-white rounded-3xl p-6 border border-[#141414]/5 shadow-sm">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="font-bold text-lg">Activity Overview</h3>
                    <select className="bg-[#E4E3E0] text-xs font-bold px-3 py-1 rounded-full border-none focus:ring-0">
                      <option>Last 7 Days</option>
                      <option>Last 30 Days</option>
                    </select>
                  </div>
                  <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData}>
                        <defs>
                          <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#141414" stopOpacity={0.1}/>
                            <stop offset="95%" stopColor="#141414" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E4E3E0" />
                        <XAxis 
                          dataKey="name" 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fontSize: 12, fill: '#141414', opacity: 0.5 }} 
                        />
                        <YAxis 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fontSize: 12, fill: '#141414', opacity: 0.5 }} 
                        />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: '#141414', 
                            border: 'none', 
                            borderRadius: '12px',
                            color: '#E4E3E0'
                          }}
                          itemStyle={{ color: '#E4E3E0' }}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="count" 
                          stroke="#141414" 
                          strokeWidth={3}
                          fillOpacity={1} 
                          fill="url(#colorCount)" 
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Topic Progress */}
                <div className="bg-white rounded-3xl p-6 border border-[#141414]/5 shadow-sm flex flex-col">
                  <h3 className="font-bold text-lg mb-6">Topic Progress</h3>
                  <div className="flex-1 space-y-4 overflow-y-auto max-h-[300px] pr-2 custom-scrollbar">
                    {topicProgress.map((item) => (
                      <div key={item.topic} className="space-y-1">
                        <div className="flex justify-between text-xs font-bold">
                          <span>{item.topic}</span>
                          <span className="opacity-50">{item.solved}/{item.total}</span>
                        </div>
                        <div className="h-2 bg-[#E4E3E0] rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${item.percentage}%` }}
                            className="h-full bg-[#141414]"
                          />
                        </div>
                      </div>
                    ))}
                    {topicProgress.length === 0 && (
                      <div className="flex flex-col items-center justify-center h-full opacity-30 py-12">
                        <BookOpen className="w-12 h-12 mb-2" />
                        <p className="text-sm font-bold">No topics tracked yet</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Recent Problems */}
              <div className="bg-white rounded-3xl p-6 border border-[#141414]/5 shadow-sm">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="font-bold text-lg">Recent Practice</h3>
                  <button onClick={() => setActiveTab('problems')} className="text-xs font-bold underline underline-offset-4 hover:opacity-60">View All</button>
                </div>
                <div className="space-y-2">
                  {data.problems.slice(0, 5).map((problem) => (
                    <div key={problem.id} className="flex items-center justify-between p-4 bg-[#E4E3E0]/30 rounded-2xl hover:bg-[#E4E3E0]/50 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className={cn(
                          "w-2 h-2 rounded-full",
                          problem.difficulty === 'Easy' ? "bg-emerald-500" :
                          problem.difficulty === 'Medium' ? "bg-orange-500" : "bg-rose-500"
                        )} />
                        <div>
                          <p className="font-bold text-sm">{problem.title}</p>
                          <p className="text-[10px] opacity-50 uppercase tracking-wider font-bold">{problem.topic}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className={cn(
                          "text-[10px] font-bold px-2 py-1 rounded-full uppercase",
                          problem.status === 'Solved' ? "bg-emerald-100 text-emerald-700" :
                          problem.status === 'Revising' ? "bg-orange-100 text-orange-700" : "bg-gray-100 text-gray-700"
                        )}>
                          {problem.status}
                        </span>
                        <span className="text-[10px] opacity-40 font-mono">{format(parseISO(problem.dateAdded), 'MMM dd')}</span>
                      </div>
                    </div>
                  ))}
                  {data.problems.length === 0 && (
                    <div className="text-center py-12 opacity-30">
                      <p className="font-bold">Start solving problems to see them here</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'problems' && (
            <motion.div 
              key="problems"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-white p-4 rounded-3xl border border-[#141414]/5 shadow-sm">
                <div className="relative w-full md:w-96">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 opacity-30" />
                  <input 
                    type="text" 
                    placeholder="Search problems..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-12 pr-4 py-2 bg-[#E4E3E0]/50 rounded-full border-none focus:ring-2 focus:ring-[#141414]/10 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto pb-2 md:pb-0 no-scrollbar">
                  <Filter className="w-4 h-4 opacity-30 shrink-0" />
                  {['All', ...TOPICS].map(topic => (
                    <button
                      key={topic}
                      onClick={() => setFilterTopic(topic)}
                      className={cn(
                        "whitespace-nowrap px-4 py-1.5 rounded-full text-xs font-bold transition-all",
                        filterTopic === topic ? "bg-[#141414] text-[#E4E3E0]" : "bg-[#E4E3E0]/50 hover:bg-[#E4E3E0]"
                      )}
                    >
                      {topic}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3">
                {filteredProblems.map((problem) => (
                  <motion.div 
                    layout
                    key={problem.id} 
                    className="group bg-white p-5 rounded-3xl border border-[#141414]/5 shadow-sm hover:shadow-md transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    <div className="flex items-start gap-4">
                      <div className={cn(
                        "mt-1.5 w-3 h-3 rounded-full shrink-0",
                        problem.difficulty === 'Easy' ? "bg-emerald-500" :
                        problem.difficulty === 'Medium' ? "bg-orange-500" : "bg-rose-500"
                      )} />
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-lg">{problem.title}</h4>
                          {problem.link && (
                            <a href={problem.link} target="_blank" rel="noopener noreferrer" className="opacity-0 group-hover:opacity-100 transition-opacity">
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-[10px] font-bold uppercase tracking-widest opacity-40">{problem.topic}</span>
                          <span className="text-[10px] font-bold uppercase tracking-widest opacity-40">•</span>
                          <span className="text-[10px] font-bold uppercase tracking-widest opacity-40">{problem.difficulty}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 self-end md:self-center">
                      <select 
                        value={problem.status}
                        onChange={(e) => updateProblemStatus(problem.id, e.target.value as ProblemStatus)}
                        className={cn(
                          "text-xs font-bold px-4 py-2 rounded-full border-none focus:ring-0 cursor-pointer",
                          problem.status === 'Solved' ? "bg-emerald-100 text-emerald-700" :
                          problem.status === 'Revising' ? "bg-orange-100 text-orange-700" : "bg-gray-100 text-gray-700"
                        )}
                      >
                        <option value="Solved">Solved</option>
                        <option value="Revising">Revising</option>
                        <option value="Unsolved">Unsolved</option>
                      </select>
                      <button 
                        onClick={() => deleteProblem(problem.id)}
                        className="p-2 text-rose-500 hover:bg-rose-50 rounded-full transition-colors"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </motion.div>
                ))}
                {filteredProblems.length === 0 && (
                  <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-[#141414]/20 opacity-40">
                    <Search className="w-12 h-12 mx-auto mb-4" />
                    <p className="font-bold">No problems found matching your criteria</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {activeTab === 'notes' && (
            <motion.div 
              key="notes"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="grid grid-cols-1 lg:grid-cols-3 gap-8"
            >
              <div className="lg:col-span-1">
                <div className="bg-white p-6 rounded-3xl border border-[#141414]/5 shadow-sm sticky top-8">
                  <h3 className="font-bold text-lg mb-6">Quick Note</h3>
                  <form onSubmit={addNote} className="space-y-4">
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest opacity-40 block mb-1">Title</label>
                      <input 
                        name="title"
                        required
                        placeholder="e.g. Binary Search Tips"
                        className="w-full px-4 py-2 bg-[#E4E3E0]/50 rounded-xl border-none focus:ring-2 focus:ring-[#141414]/10 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest opacity-40 block mb-1">Content</label>
                      <textarea 
                        name="content"
                        required
                        rows={6}
                        placeholder="Write your notes here..."
                        className="w-full px-4 py-2 bg-[#E4E3E0]/50 rounded-xl border-none focus:ring-2 focus:ring-[#141414]/10 text-sm resize-none"
                      />
                    </div>
                    <button className="w-full bg-[#141414] text-[#E4E3E0] py-3 rounded-xl font-bold hover:opacity-90 transition-opacity">
                      Save Note
                    </button>
                  </form>
                </div>
              </div>

              <div className="lg:col-span-2 space-y-4">
                {data.notes.map((note) => (
                  <div key={note.id} className="bg-white p-6 rounded-3xl border border-[#141414]/5 shadow-sm group">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h4 className="font-bold text-xl">{note.title}</h4>
                        <p className="text-[10px] font-mono opacity-40 uppercase tracking-widest mt-1">{format(parseISO(note.date), 'MMMM do, yyyy')}</p>
                      </div>
                      <button 
                        onClick={() => deleteNote(note.id)}
                        className="p-2 text-rose-500 hover:bg-rose-50 rounded-full opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                    <p className="text-sm leading-relaxed opacity-80 whitespace-pre-wrap">{note.content}</p>
                  </div>
                ))}
                {data.notes.length === 0 && (
                  <div className="text-center py-20 opacity-30">
                    <StickyNote className="w-16 h-16 mx-auto mb-4" />
                    <p className="font-bold text-lg">Your notes will appear here</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
          {activeTab === 'profile' && (
            <motion.div 
              key="profile"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-2xl mx-auto"
            >
              <div className="bg-white rounded-[40px] overflow-hidden border border-[#141414]/5 shadow-sm">
                <div className="h-32 bg-[#141414]" />
                <div className="px-8 pb-8">
                  <div className="relative -mt-12 mb-6">
                    <div className="w-24 h-24 rounded-3xl bg-gradient-to-tr from-[#E4E3E0] to-gray-400 border-4 border-white flex items-center justify-center text-3xl font-bold text-[#141414] shadow-lg">
                      {user.displayName?.charAt(0) || user.email?.charAt(0).toUpperCase()}
                    </div>
                  </div>
                  
                  <div className="space-y-6">
                    <div>
                      <h2 className="text-2xl font-bold">{user.displayName || 'Student'}</h2>
                      <p className="text-sm opacity-50">{user.email}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-[#E4E3E0]/30 p-4 rounded-2xl">
                        <p className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-1">Current Streak</p>
                        <p className="text-xl font-bold flex items-center gap-2">
                          <Flame className="w-5 h-5 text-orange-500 fill-orange-500" />
                          {data.profile?.streak || 0} Days
                        </p>
                      </div>
                      <div className="bg-[#E4E3E0]/30 p-4 rounded-2xl">
                        <p className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-1">Problems Solved</p>
                        <p className="text-xl font-bold flex items-center gap-2">
                          <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                          {stats.solved}
                        </p>
                      </div>
                    </div>

                    <div className="pt-6 border-t border-[#141414]/5">
                      <button 
                        onClick={() => signOut(auth)}
                        className="flex items-center gap-2 text-rose-500 font-bold hover:opacity-60 transition-opacity"
                      >
                        <LogOut className="w-5 h-5" />
                        Sign Out
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Add Problem Modal */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddModalOpen(false)}
              className="absolute inset-0 bg-[#141414]/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-lg bg-[#E4E3E0] rounded-[40px] p-8 shadow-2xl overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-emerald-500 via-orange-500 to-rose-500" />
              
              <h2 className="text-2xl font-bold mb-6 italic font-serif">Track New Problem</h2>
              
              {operationError && (
                <div className="mb-6 p-4 bg-rose-50 text-rose-600 rounded-2xl flex items-center gap-3 text-sm font-medium">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  {operationError}
                </div>
              )}
              
              <form onSubmit={addProblem} className="space-y-6">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest opacity-40 block mb-1">Problem Title</label>
                  <input 
                    name="title"
                    required
                    autoFocus
                    placeholder="e.g. Two Sum"
                    className="w-full px-6 py-3 bg-white rounded-2xl border-none focus:ring-2 focus:ring-[#141414]/10 font-bold"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest opacity-40 block mb-1">Topic</label>
                    <select name="topic" className="w-full px-6 py-3 bg-white rounded-2xl border-none focus:ring-2 focus:ring-[#141414]/10 font-bold appearance-none">
                      {TOPICS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest opacity-40 block mb-1">Difficulty</label>
                    <select name="difficulty" className="w-full px-6 py-3 bg-white rounded-2xl border-none focus:ring-2 focus:ring-[#141414]/10 font-bold appearance-none">
                      <option value="Easy">Easy</option>
                      <option value="Medium">Medium</option>
                      <option value="Hard">Hard</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest opacity-40 block mb-1">Status</label>
                    <select name="status" defaultValue="Unsolved" className="w-full px-6 py-3 bg-white rounded-2xl border-none focus:ring-2 focus:ring-[#141414]/10 font-bold appearance-none">
                      <option value="Unsolved">Unsolved</option>
                      <option value="Solved">Solved</option>
                      <option value="Revising">Revising</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest opacity-40 block mb-1">Link (Optional)</label>
                    <input 
                      name="link"
                      placeholder="LeetCode/GFG URL"
                      className="w-full px-6 py-3 bg-white rounded-2xl border-none focus:ring-2 focus:ring-[#141414]/10 font-bold"
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button 
                    type="button"
                    onClick={() => setIsAddModalOpen(false)}
                    className="flex-1 px-6 py-4 rounded-2xl font-bold bg-white hover:bg-white/70 transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="flex-[2] px-6 py-4 rounded-2xl font-bold bg-[#141414] text-[#E4E3E0] hover:opacity-90 transition-opacity"
                  >
                    Add to Dashboard
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #14141420;
          border-radius: 10px;
        }
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}} />
    </div>
  );
}

function SidebarLink({ icon: Icon, label, active, onClick }: { 
  icon: any, 
  label: string, 
  active: boolean, 
  onClick: () => void 
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all duration-200 group",
        active 
          ? "bg-[#E4E3E0] text-[#141414] shadow-lg shadow-black/10" 
          : "text-[#E4E3E0]/50 hover:text-[#E4E3E0] hover:bg-white/5"
      )}
    >
      <Icon className={cn(
        "w-5 h-5 shrink-0 transition-transform duration-200",
        active ? "scale-110" : "group-hover:scale-110"
      )} />
      <span className={cn(
        "font-bold text-sm tracking-tight hidden md:block",
        active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
      )}>{label}</span>
    </button>
  );
}

function StatCard({ label, value, subValue, icon: Icon, color }: { 
  label: string, 
  value: number | string, 
  subValue: string, 
  icon: any,
  color: 'emerald' | 'blue' | 'orange' | 'rose'
}) {
  const colorClasses = {
    emerald: "text-emerald-500 bg-emerald-50",
    blue: "text-blue-500 bg-blue-50",
    orange: "text-orange-500 bg-orange-50",
    rose: "text-rose-500 bg-rose-50",
  };

  return (
    <div className="bg-white p-6 rounded-[32px] border border-[#141414]/5 shadow-sm hover:shadow-md transition-all group">
      <div className="flex items-center justify-between mb-4">
        <div className={cn("p-3 rounded-2xl transition-transform group-hover:scale-110", colorClasses[color])}>
          <Icon className="w-6 h-6" />
        </div>
        <ChevronRight className="w-5 h-5 opacity-10" />
      </div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-40">{label}</p>
        <div className="flex items-baseline gap-2 mt-1">
          <h4 className="text-3xl font-bold tracking-tighter">{value}</h4>
          <span className="text-[10px] font-bold opacity-30 uppercase">{subValue}</span>
        </div>
      </div>
    </div>
  );
}
