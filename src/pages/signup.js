import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { auth, firestore } from "../firebase";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

function Signup() {
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const passwordStrength = useMemo(() => {
    const pwd = formData.password;
    if (!pwd) return { score: 0, label: "Weak", color: "bg-slate-200", textColor: "text-slate-400" };
    let score = 0;
    if (pwd.length >= 6) score++;
    if (pwd.length >= 10) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;
    if (score <= 1) return { score: 20, label: "Weak", color: "bg-red-400", textColor: "text-red-500" };
    if (score <= 2) return { score: 40, label: "Fair", color: "bg-orange-400", textColor: "text-orange-500" };
    if (score <= 3) return { score: 60, label: "Good", color: "bg-yellow-400", textColor: "text-yellow-600" };
    if (score <= 4) return { score: 80, label: "Strong", color: "bg-lime-400", textColor: "text-lime-600" };
    return { score: 100, label: "Very strong", color: "bg-emerald-400", textColor: "text-emerald-600" };
  }, [formData.password]);

  const passwordsMatch = formData.password === formData.confirmPassword;
  const passwordsDirty = formData.confirmPassword.length > 0;

  const handleSignup = async (e) => {
    e.preventDefault();
    const { fullName, email, password, confirmPassword } = formData;

    if (!fullName.trim() || !email.trim() || !password.trim() || !confirmPassword.trim()) {
      toast.error("Please fill in all fields.");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);

    try {
      const userCredential = await auth.createUserWithEmailAndPassword(email, password);
      const user = userCredential.user;

      await firestore.collection("users").doc(user.uid).set({
        fullName,
        email,
        phone: "",
        role: "driver",
        status: "active",
        ownerId: null,
        assignedParkingIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      toast.success("Account created successfully.");
    } catch (err) {
      if (err.code === "auth/email-already-in-use") {
        toast.error("This email is already in use.");
      } else if (err.code === "auth/invalid-email") {
        toast.error("Please enter a valid email address.");
      } else if (err.code === "auth/weak-password") {
        toast.error("Password is too weak.");
      } else if (err.code === "auth/operation-not-allowed") {
        toast.error("Email/password signup is not enabled in Firebase Auth.");
      } else {
        toast.error(`Signup failed: ${err.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative mx-auto flex min-h-[85vh] w-full max-w-xl items-center justify-center px-4 py-8">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-20 -top-20 h-60 w-60 rounded-full bg-blue-500/5 blur-3xl" />
        <div className="absolute -bottom-20 -right-20 h-60 w-60 rounded-full bg-indigo-500/5 blur-3xl" />
      </div>

      <Card className="relative w-full animate-scale-in shadow-premium-lg">
        <CardHeader className="space-y-2 pb-4 pt-7 text-center">
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-glow-emerald">
            <svg className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z" />
            </svg>
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight md:text-3xl">Create Account</CardTitle>
          <CardDescription>Get started with Enderase parking in under a minute.</CardDescription>
        </CardHeader>

        <CardContent className="pb-7">
          <form onSubmit={handleSignup} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fullName" className="text-xs font-medium">Full Name</Label>
              <Input
                id="fullName"
                name="fullName"
                value={formData.fullName}
                onChange={handleChange}
                placeholder="John Doe"
                autoComplete="name"
                required
                className="h-11 rounded-lg border-slate-200 bg-white/50 transition-all focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs font-medium">Email</Label>
              <Input
                id="email"
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="you@example.com"
                autoComplete="email"
                required
                className="h-11 rounded-lg border-slate-200 bg-white/50 transition-all focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="password" className="text-xs font-medium">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    placeholder="Create a password"
                    autoComplete="new-password"
                    required
                    className="h-11 rounded-lg border-slate-200 bg-white/50 pr-10 transition-all focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {formData.password && (
                  <div className="pt-1">
                    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                      <div
                        className={`transition-all duration-500 ease-out ${passwordStrength.color}`}
                        style={{ width: `${passwordStrength.score}%` }}
                      />
                    </div>
                    <p className={`mt-0.5 text-[10px] font-medium ${passwordStrength.textColor}`}>
                      {passwordStrength.label}
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-xs font-medium">Confirm Password</Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showConfirm ? "text" : "password"}
                    name="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    placeholder="Re-enter password"
                    autoComplete="new-password"
                    required
                    className={`h-11 rounded-lg border-slate-200 bg-white/50 pr-10 transition-all focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 ${
                      passwordsDirty && !passwordsMatch ? "border-red-300 focus:border-red-400 focus:ring-red-500/20" : ""
                    } ${
                      passwordsDirty && passwordsMatch ? "border-emerald-300 focus:border-emerald-400 focus:ring-emerald-500/20" : ""
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    aria-label={showConfirm ? "Hide confirm" : "Show confirm"}
                  >
                    {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {passwordsDirty && !passwordsMatch && (
                  <p className="flex items-center gap-1 pt-0.5 text-[10px] font-medium text-red-500">
                    <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7 4a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm-1-9a1 1 0 0 0-1 1v4a1 1 0 1 0 2 0V6a1 1 0 0 0-1-1Z" clipRule="evenodd" /></svg>
                    Passwords do not match
                  </p>
                )}
                {passwordsDirty && passwordsMatch && (
                  <p className="flex items-center gap-1 pt-0.5 text-[10px] font-medium text-emerald-500">
                    <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" /></svg>
                    Passwords match
                  </p>
                )}
              </div>
            </div>

            <Button type="submit" variant="premium-emerald" className="w-full h-11 text-base" disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {loading ? "Creating account..." : "Create Account"}
            </Button>
          </form>

          <div className="mt-6 text-center text-xs text-slate-500">
            Already have an account?{" "}
            <Link to="/login" className="font-semibold text-blue-600 hover:text-blue-700 transition-colors">
              Sign in
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default Signup;
