import { useEffect, createContext, useContext, useState, type ReactNode } from 'react';
import { ArrowRight, Boxes, ChartNoAxesCombined, ClipboardCheck, Warehouse } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import axios from 'axios';
import { toast } from 'sonner';
import { session, errorMessage } from '../api/client';
import { authApi, list } from '../api/services';
import type { Profile, Role } from '../api/types';
import { Brand, Header, Issue, Loading, Missing } from '../components/ui';

interface AuthState { profile?: Profile; role?: Role; ready: boolean; signedIn: boolean; issue: unknown; retry: () => void; login: (data: Credentials) => Promise<void>; logout: () => Promise<void> }
const Context = createContext<AuthState | null>(null);
export function useAuth() {
  const auth = useContext(Context);
  if (!auth) throw new Error('Auth provider missing');
  return auth;
}
export function AuthProvider({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState(Boolean(session.get()));
  const cache = useQueryClient();
  const profile = useQuery({ queryKey: ['session', 'profile'], queryFn: ({ signal }) => authApi.profile(signal), enabled: signedIn, retry: false });
  const role = useQuery({
    queryKey: ['session', 'effective-role', profile.data?.id],
    enabled: signedIn && profile.data?.role === 'customer',
    retry: false,
    queryFn: async ({ signal }) => {
      try { await list('users', { page: 1 }, signal); return 'admin' as const; }
      catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 403) return 'customer' as const;
        throw error;
      }
    },
  });
  useEffect(() => {
    function expire() {
      setSignedIn(false);
      cache.clear();
      toast.error('Your session expired. Sign in again.');
    }
    window.addEventListener('stocksmart:expired', expire);
    return () => window.removeEventListener('stocksmart:expired', expire);
  }, [cache]);
  return <Context.Provider value={{
    signedIn,
    profile: signedIn ? profile.data : undefined,
    role: signedIn ? role.data || profile.data?.role : undefined,
    ready: !signedIn || Boolean(profile.data && (profile.data.role !== 'customer' || role.data)),
    issue: profile.error || role.error,
    retry: () => { if (profile.error) void profile.refetch(); else void role.refetch(); },
    async login(data) {
      session.set(await authApi.login(data));
      cache.clear();
      setSignedIn(true);
    },
    async logout() {
      const token = session.get()?.refresh;
      try { if (token) await authApi.logout(token); }
      catch { toast.error('Signed out locally. The server could not revoke the refresh token.'); }
      finally { session.set(null); cache.clear(); setSignedIn(false); }
    },
  }}>{children}</Context.Provider>;
}

const credentials = z.object({ username: z.string().trim().min(1, 'Enter your username').max(150), password: z.string().min(1, 'Enter your password') });
type Credentials = z.infer<typeof credentials>;
const registration = credentials.extend({ password: z.string().min(8, 'Use at least 8 characters'), email: z.union([z.email(), z.literal('')]) });
type Registration = z.infer<typeof registration>;

export function AuthPage({ register = false }: { register?: boolean }) {
  const auth = useAuth();
  return auth.signedIn ? <Navigate to="/" replace /> : <main className="auth-screen">
    <aside className="auth-story">
      <Brand />
      <div className="auth-story-copy"><div className="auth-kicker"><span /> RETAIL INVENTORY WORKSPACE</div>
        <h1>Every item.<br />Every location.</h1>
        <p>Manage stock, fulfill orders, and see what needs your attention across stores and warehouses.</p>
        <div className="auth-art" aria-hidden>
          <div className="art-grid"></div><div className="art-tile t1"><Warehouse size={25}/></div>
          <div className="art-tile t2"><Boxes size={37}/></div><div className="art-tile t3"><ClipboardCheck size={24}/></div>
          <div className="art-tile t4"><ChartNoAxesCombined size={27}/></div>
        </div>
      </div>
      <div className="auth-footer">StockSmart <span /> Inventory operations</div>
    </aside>
    <section className="auth-panel">
      <div className="mobile-brand"><Brand /></div>
      {register ? <RegisterForm /> : <LoginForm />}
    </section>
  </main>;
}
function LoginForm() {
  const auth = useAuth();
  const [error, setError] = useState<unknown>();
  const form = useForm<Credentials>({ resolver: zodResolver(credentials), defaultValues: { username: '', password: '' } });
  return <form className="auth-form" onSubmit={form.handleSubmit(async (data) => {
    setError(undefined);
    try { await auth.login(data); } catch (failure) { setError(failure); }
  })}>
    <header><h2>Welcome back</h2><p>Sign in to your StockSmart account.</p></header>
    <label>Username<input autoComplete="username" placeholder="Enter your username" {...form.register('username')} />{form.formState.errors.username && <small className="field-error">{form.formState.errors.username.message}</small>}</label>
    <label>Password<input type="password" autoComplete="current-password" placeholder="Enter your password" {...form.register('password')} />{form.formState.errors.password && <small className="field-error">{form.formState.errors.password.message}</small>}</label>
    {Boolean(error) && <Issue error={error} />}
    <button className="button primary auth-submit" disabled={form.formState.isSubmitting}>Sign in <ArrowRight size={17} /></button>
    <p className="auth-switch">Shopping with StockSmart? <Link to="/register">Create an account</Link></p>
  </form>;
}
function RegisterForm() {
  const auth = useAuth();
  const [error, setError] = useState<unknown>();
  const form = useForm<Registration>({ resolver: zodResolver(registration), defaultValues: { username: '', email: '', password: '' } });
  return <form className="auth-form" onSubmit={form.handleSubmit(async (data) => {
    setError(undefined);
    try {
      await authApi.register(data);
      await auth.login({ username: data.username, password: data.password });
      toast.success('Account created');
    } catch (failure) { setError(failure); }
  })}>
    <header><h2>Create an account</h2><p>Browse the catalog and manage your orders.</p></header>
    <label>Username<input autoComplete="username" {...form.register('username')} />{form.formState.errors.username && <small className="field-error">{form.formState.errors.username.message}</small>}</label>
    <label>Email <span className="optional">optional</span><input type="email" autoComplete="email" {...form.register('email')} />{form.formState.errors.email && <small className="field-error">{form.formState.errors.email.message}</small>}</label>
    <label>Password<input type="password" autoComplete="new-password" {...form.register('password')} />{form.formState.errors.password && <small className="field-error">{form.formState.errors.password.message}</small>}</label>
    {Boolean(error) && <Issue error={error} />}
    <button className="button primary auth-submit" disabled={form.formState.isSubmitting}>Create account <ArrowRight size={17} /></button>
    <p className="auth-switch">Already registered? <Link to="/login">Sign in</Link></p>
  </form>;
}
export function Gate({ allow, children }: { allow?: Role[]; children: ReactNode }) {
  const auth = useAuth();
  if (!auth.signedIn) return <Navigate to="/login" replace />;
  if (auth.issue) return <main className="missing"><Brand /><Issue error={auth.issue} retry={auth.retry} /><button className="button" onClick={() => void auth.logout()}>Sign out</button></main>;
  if (!auth.ready || !auth.role) return <main className="missing"><Brand /><Loading label="Restoring your session" /></main>;
  if (allow && !allow.includes(auth.role)) return <Missing denied />;
  return children;
}
const profileFields = z.object({ first_name: z.string().max(150), last_name: z.string().max(150), email: z.union([z.email(), z.literal('')]) });
const passwordFields = z.object({ current_password: z.string().min(1), new_password: z.string().min(8, 'Use at least 8 characters') });

export function Account() {
  const auth = useAuth();
  const cache = useQueryClient();
  const profile = auth.profile!;
  const details = useForm({ resolver: zodResolver(profileFields), defaultValues: { first_name: profile.first_name, last_name: profile.last_name, email: profile.email } });
  const password = useForm({ resolver: zodResolver(passwordFields), defaultValues: { current_password: '', new_password: '' } });
  const [errors, setErrors] = useState<{ details?: unknown; password?: unknown }>({});
  return <>
    <Header title="Account settings" description="Manage your personal details and sign-in security." />
    <div className="two-panels">
      <form className="panel form-panel" onSubmit={details.handleSubmit(async (data) => {
        setErrors((value) => ({ ...value, details: undefined }));
        try { cache.setQueryData(['session', 'profile'], await authApi.update(data)); toast.success('Profile updated'); }
        catch (error) { setErrors((value) => ({ ...value, details: error })); }
      })}>
        <h2>Personal details</h2>
        <label>Username<input readOnly value={profile.username} /></label>
        <label>First name<input {...details.register('first_name')} />{details.formState.errors.first_name && <small className="field-error">{details.formState.errors.first_name.message}</small>}</label>
        <label>Last name<input {...details.register('last_name')} />{details.formState.errors.last_name && <small className="field-error">{details.formState.errors.last_name.message}</small>}</label>
        <label>Email<input type="email" {...details.register('email')} />{details.formState.errors.email && <small className="field-error">{details.formState.errors.email.message}</small>}</label>
        {Boolean(errors.details) && <Issue error={errors.details} />}
        <button className="button primary" disabled={details.formState.isSubmitting}>Save profile</button>
      </form>
      <form className="panel form-panel" onSubmit={password.handleSubmit(async (data) => {
        setErrors((value) => ({ ...value, password: undefined }));
        try { await authApi.password(data); session.set(null); await auth.logout(); toast.success('Password changed. Sign in with your new password.'); }
        catch (error) { setErrors((value) => ({ ...value, password: errorMessage(error) ? error : new Error('Unable to change password') })); }
      })}>
        <h2>Change password</h2>
        <label>Current password<input type="password" autoComplete="current-password" {...password.register('current_password')} />{password.formState.errors.current_password && <small className="field-error">Enter your current password</small>}</label>
        <label>New password<input type="password" autoComplete="new-password" {...password.register('new_password')} />{password.formState.errors.new_password && <small className="field-error">{password.formState.errors.new_password.message}</small>}</label>
        {Boolean(errors.password) && <Issue error={errors.password} />}
        <button className="button primary" disabled={password.formState.isSubmitting}>Update password</button>
      </form>
    </div>
  </>;
}
