import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase, isSupabaseConfigured } from '../utils/supabase';
import { Sparkles, Mail, Lock, AlertCircle, Loader, KeyRound, Eye, EyeOff, Sun, Moon } from 'lucide-react';

export default function Auth({ onAuthSuccess, theme = 'dark', onToggleTheme }) {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [forgotPasswordMode, setForgotPasswordMode] = useState(false);

  const renderError = () => {
    if (!error) return null;
    const isNetworkError = error.includes('Failed to fetch') || error.includes('FetchError') || error.includes('NetworkError');
    
    return (
      <div className="flex flex-col gap-1.5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs text-left">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span className="leading-normal font-bold">
            {isNetworkError ? 'Network Connection Error' : 'Authentication Error'}
          </span>
        </div>
        <div className="leading-relaxed pl-6 text-slate-300 text-[11px]">
          {isNetworkError ? (
            <div>
              Cannot connect to your Supabase instance. Please check:
              <ul className="list-disc pl-4 mt-1 space-y-0.5 font-normal text-slate-400">
                <li>Whether your Supabase project is <strong>paused</strong> (visit the Supabase Dashboard to resume it).</li>
                <li>Whether an adblocker or Brave Shields is blocking the request.</li>
                <li>Your local network connection.</li>
              </ul>
            </div>
          ) : (
            <span>{error}</span>
          )}
        </div>
      </div>
    );
  };

  const renderSuccess = () => {
    if (!successMessage) return null;
    return (
      <div className="flex flex-col gap-1.5 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs text-left">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 shrink-0 text-emerald-400" />
          <span className="leading-normal font-bold">Success</span>
        </div>
        <div className="leading-relaxed pl-6 text-slate-300 text-[11px]">
          {successMessage}
        </div>
      </div>
    );
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please fill in all fields.');
      setSuccessMessage('');
      return;
    }
    setError('');
    setSuccessMessage('');
    setLoading(true);

    try {
      if (isRegister) {
        const { data, error: err } = await supabase.auth.signUp({ email, password });
        if (err) throw err;
        
        // Supabase sends a confirmation email by default unless turned off.
        // If data.user is created but data.session is null, it means email confirmation is required.
        if (data?.user && !data?.session) {
          setSuccessMessage('Registration successful! Please check your email inbox to confirm your account.');
          setError('');
          setLoading(false);
          return;
        }
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
      }
      if (onAuthSuccess) onAuthSuccess();
    } catch (err) {
      console.error(err);
      setError(err.message || 'Authentication failed. Please check your credentials.');
    } finally {
      if (!isRegister || error === '') {
        setLoading(false);
      }
    }
  };

  const handleAnonymousLogin = async () => {
    setError('');
    setSuccessMessage('');
    setLoading(true);
    try {
      const { error: err } = await supabase.auth.signInAnonymously();
      if (err) throw err;
      if (onAuthSuccess) onAuthSuccess();
    } catch (err) {
      console.error(err);
      setError(err.message || 'Anonymous sign-in failed. Please try email/password.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    if (!email) {
      setError('Please enter your email address to reset password.');
      setSuccessMessage('');
      return;
    }
    setError('');
    setSuccessMessage('');
    setLoading(true);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      if (err) throw err;
      setResetSent(true);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to send reset email.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`min-h-screen w-full flex flex-col items-center justify-start sm:justify-center relative p-6 py-12 overflow-y-auto transition-colors duration-300 ${
      theme === 'light' ? 'light-theme bg-slate-50' : 'bg-navy-950'
    }`}>
      {/* Absolute Theme Toggle Button */}
      <div className="absolute top-6 right-6 z-20">
        <button
          onClick={onToggleTheme}
          type="button"
          className="p-2.5 rounded-xl bg-slate-950/30 border border-white/10 hover:border-gold/40 text-slate-300 hover:text-white hover:bg-slate-950/60 transition-all hover:scale-105"
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {theme === 'dark' ? <Sun className="w-4 h-4 text-gold" /> : <Moon className="w-4 h-4 text-slate-600" />}
        </button>
      </div>

      {/* Background radial gradients */}
      {theme === 'dark' ? (
        <>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-20%,#2a2015_0%,#0c0a09_70%)]" />
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-gold/5 rounded-full filter blur-[100px] animate-pulse" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-gold-dark/5 rounded-full filter blur-[100px] animate-pulse" style={{ animationDelay: '2s' }} />
        </>
      ) : (
        <>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-20%,#F5F0E6_0%,#FAF8F5_70%)] opacity-80" />
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-gold/5 rounded-full filter blur-[100px] animate-pulse" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-gold-dark/5 rounded-full filter blur-[100px] animate-pulse" style={{ animationDelay: '2s' }} />
        </>
      )}

      <motion.div 
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="w-full max-w-md z-10"
      >
        {/* Top Branding Header */}
        <div className="text-center mb-8">
          <div className="inline-flex p-3.5 rounded-2xl bg-gradient-to-br from-gold-dark/20 to-gold/5 border border-gold/30 gold-glow mb-4">
            <Sparkles className="w-8 h-8 text-gold" />
          </div>
          <h2 className="font-academic text-2xl sm:text-3xl font-extrabold tracking-tight text-white mb-2">
            Yeseswini's <span className="text-gold-light">Study Assistant</span>
          </h2>

        </div>

        {/* Auth Glass Card */}
        <div className="glass-card rounded-3xl p-8 relative overflow-hidden border border-white/5 shadow-2xl">
          <div className="absolute top-0 left-0 w-full h-[3px] bg-gradient-to-r from-gold-dark via-gold-light to-gold-dark" />
          
          <AnimatePresence mode="wait">
            {forgotPasswordMode ? (
              <motion.div
                key="forgot"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ duration: 0.2 }}
              >
                <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                  <KeyRound className="w-5 h-5 text-gold" /> Reset Password
                </h3>
                <p className="text-slate-400 text-xs font-light mb-6">
                  Enter your email address and we'll send you a secure link to reset your password.
                </p>

                {resetSent ? (
                  <div className="text-center py-4">
                    <div className="inline-flex p-3 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 mb-4">
                      <Sparkles className="w-6 h-6 animate-pulse" />
                    </div>
                    <p className="text-emerald-400 text-sm font-semibold mb-1">Reset Link Sent!</p>
                    <p className="text-slate-400 text-xs mb-6 px-4">Check your email inbox and follow the instructions to reset your password.</p>
                    <button
                      onClick={() => {
                        setResetSent(false);
                        setForgotPasswordMode(false);
                        setError('');
                      }}
                      className="w-full py-3 px-4 rounded-xl border border-white/10 text-white hover:bg-white/5 transition-all text-sm font-medium"
                    >
                      Back to Login
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleForgotPassword} className="space-y-4">
                    {renderError()}
                    {renderSuccess()}
                    
                    <div className="space-y-1.5">
                      <label className="text-slate-300 text-xs font-semibold">Email Address</label>
                      <div className="relative">
                        <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="w-full py-3.5 pl-11 pr-4 rounded-xl glass-input text-sm"
                          placeholder="student@university.edu"
                          disabled={loading}
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-3.5 px-4 rounded-xl gold-gradient text-navy-950 font-bold hover:opacity-95 active:scale-[0.98] transition-all text-sm flex items-center justify-center gap-2 shadow-lg shadow-gold/10"
                    >
                      {loading ? <Loader className="w-4 h-4 animate-spin" /> : 'Send Reset Link'}
                    </button>

                    <div className="text-center pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setForgotPasswordMode(false);
                          setError('');
                        }}
                        className="text-gold-light hover:text-gold hover:underline text-xs"
                      >
                        Back to Login
                      </button>
                    </div>
                  </form>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="login"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ duration: 0.2 }}
              >
                <div className="flex border-b border-white/5 mb-6">
                  <button
                    onClick={() => { setIsRegister(false); setError(''); setSuccessMessage(''); }}
                    className={`flex-1 pb-3 text-sm font-semibold border-b-2 transition-all ${!isRegister ? 'border-gold text-gold-light' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
                  >
                    Sign In
                  </button>
                  <button
                    onClick={() => { setIsRegister(true); setError(''); setSuccessMessage(''); }}
                    className={`flex-1 pb-3 text-sm font-semibold border-b-2 transition-all ${isRegister ? 'border-gold text-gold-light' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
                  >
                    Register
                  </button>
                </div>

                <form onSubmit={handleAuth} className="space-y-4">
                  {renderError()}
                  {renderSuccess()}

                  <div className="space-y-1.5">
                    <label className="text-slate-300 text-xs font-semibold">Email Address</label>
                    <div className="relative">
                      <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full py-3.5 pl-11 pr-4 rounded-xl glass-input text-sm"
                        placeholder="student@university.edu"
                        disabled={loading}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <label className="text-slate-300 text-xs font-semibold">Password</label>
                      {!isRegister && (
                        <button
                          type="button"
                          onClick={() => { setForgotPasswordMode(true); setError(''); }}
                          className="text-gold-light hover:text-gold hover:underline text-[11px]"
                        >
                          Forgot Password?
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full py-3.5 pl-11 pr-11 rounded-xl glass-input text-sm"
                        placeholder="••••••••"
                        disabled={loading}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3.5 px-4 rounded-xl gold-gradient text-navy-950 font-bold hover:opacity-95 active:scale-[0.98] transition-all text-sm flex items-center justify-center gap-2 shadow-lg shadow-gold/10"
                  >
                    {loading ? <Loader className="w-4 h-4 animate-spin" /> : (isRegister ? 'Create Account' : 'Sign In')}
                  </button>
                </form>

                {/* Divider */}
                <div className="relative flex py-5 items-center">
                  <div className="flex-grow border-t border-white/5"></div>
                  <span className="flex-shrink mx-4 text-slate-500 text-[10px] uppercase font-bold tracking-wider">or</span>
                  <div className="flex-grow border-t border-white/5"></div>
                </div>

                {/* Anonymous / Guest Access */}
                <button
                  type="button"
                  onClick={handleAnonymousLogin}
                  disabled={loading}
                  className="w-full py-3.5 px-4 rounded-xl border border-white/10 hover:border-gold/30 hover:bg-white/5 text-slate-300 hover:text-white font-medium transition-all text-sm flex items-center justify-center gap-2"
                >
                  Continue as Guest
                </button>
                <p className="text-center text-[10px] text-slate-500 mt-3 font-light px-4">
                  * Guest data is session-based and may be lost when cache is cleared.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
