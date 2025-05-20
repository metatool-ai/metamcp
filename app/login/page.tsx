"use client";
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

export default function LoginPage() {
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  // If already authenticated, redirect immediately
  useEffect(() => {
    if (document.cookie.includes("sb:token=")) {
      window.location.href = '/';
    }
  }, [router]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setIsLoading(false);
    if (error) {
      setError(error.message);
    } else {
      if (data.session && data.session.access_token) {
        // Set the token in a cookie so that middleware can detect the session.
        document.cookie = `sb:token=${data.session.access_token}; path=/;`;
      }
      window.location.href = '/';
    }
  };

  const handleForgotPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'http://localhost:12005/reset'
    });
    if (error) {
      setError(error.message);
    } else {
      setMessage('Password reset email sent.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center">
      {isForgotPassword ? (
        <form onSubmit={handleForgotPasswordSubmit} className="p-6 w-1/3 border rounded-md shadow-md">
          <h2 className="text-2xl font-bold mb-4">Reset Password</h2>
          {error && <p className="text-red-500 mb-2">{error}</p>}
          {message && <p className="text-green-500 mb-2">{message}</p>}
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border p-2 rounded"
              placeholder="Enter your email"
              title="Email"
              required
            />
          </div>
          <button
            type="submit"
            className="w-full  text-white py-2 rounded bg-gray-800"
          >
            Send Reset Link
          </button>
          <p className="mt-4 text-sm">
            Remembered your password?{' '}
            <button
              type="button"
              className="text-blue-600 hover:underline"
              onClick={() => {
                setIsForgotPassword(false);
                setError(null);
                setMessage(null);
              }}
            >
              Back to Login
            </button>
          </p>
        </form>
      ) : (
        <form onSubmit={handleLoginSubmit} className="p-6 border w-1/3 rounded-md shadow-md">
          <h2 className="text-2xl font-bold mb-4">Login</h2>
          {error && <p className="text-red-500 mb-2">{error}</p>}
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border p-2 rounded"
              placeholder="Enter your email"
              title="Email"
              required
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border p-2 rounded"
              placeholder="Enter your password"
              title="Password"
              required
            />
          </div>
          <button
            type="submit"
            className="w-full text-white bg-gray-800 py-2 rounded"
            disabled={isLoading}
          >
            {isLoading ? "Logging in..." : "Login"}
          </button>
          <p className="mt-4 text-sm">
            <button
              type="button"
              className="text-blue-600 hover:underline"
              onClick={() => {
                setIsForgotPassword(true);
                setError(null);
                setMessage(null);
              }}
            >
              Forgot Password?
            </button>
          </p>
        </form>
      )}
    </div>
  );
}
