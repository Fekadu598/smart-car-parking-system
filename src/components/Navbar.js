import React, { useEffect, useRef, useState } from "react";
import { LogOut, Menu, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { auth, firestore } from "../firebase";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

const brandLogoUrl = `${process.env.PUBLIC_URL}/logo.svg`;

function Navbar({ userRole, userName, userEmail, photoURL, onPhotoURLChange }) {
  const navigate = useNavigate();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [photoPopover, setPhotoPopover] = useState(false);
  const [photoInput, setPhotoInput] = useState("");
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [photoPreview, setPhotoPreview] = useState("");
  const popoverRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!photoPopover) return;
    const handler = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setPhotoPopover(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [photoPopover]);

  const handleLogout = async () => {
    if (!window.confirm("Are you sure you want to logout?")) return;
    try {
      setIsSigningOut(true);
      setMobileOpen(false);
      await auth.signOut();
    } finally {
      setIsSigningOut(false);
      navigate("/login", { replace: true });
    }
  };

  const handleSavePhoto = async () => {
    const url = (photoPreview || photoInput).trim();
    if (!url) return;
    setSavingPhoto(true);
    try {
      const uid = auth.currentUser?.uid;
      if (uid) {
        await firestore.collection("users").doc(uid).update({ photoURL: url });
      }
      onPhotoURLChange(url);
      setPhotoPopover(false);
      setPhotoInput("");
      setPhotoPreview("");
    } catch (err) {
      console.error("Failed to save photo", err);
    } finally {
      setSavingPhoto(false);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setPhotoPreview(ev.target.result);
      setPhotoInput("");
    };
    reader.readAsDataURL(file);
  };

  const roleLabel = {
    admin: "Admin",
    owner: "Owner",
    operator: "Operator",
    driver: "Driver",
    user: "Driver",
  };

  const avatarContent = photoURL ? (
    <img src={photoURL} alt="" className="h-full w-full rounded-full object-cover" />
  ) : (
    <span className="text-sm font-bold">{(userName || userEmail || "?").charAt(0).toUpperCase()}</span>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-border/40 bg-white/80 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between px-4 py-2.5 md:px-6">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 p-0.5 shadow-sm">
            <img src={brandLogoUrl} alt="Enderase" className="h-9 w-9 rounded-[10px] bg-white object-cover md:h-10 md:w-10" />
          </div>
          <div>
            <p className="font-heading text-base font-bold tracking-tight text-slate-900 md:text-lg">Enderase</p>
            <p className="text-[9px] font-medium uppercase tracking-[0.15em] text-slate-400 md:text-[10px]">Smart Parking</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative hidden items-center gap-2.5 rounded-xl border border-border/60 bg-white/50 px-3 py-1.5 shadow-sm md:flex">
            <button type="button" onClick={() => { setPhotoPopover(!photoPopover); setPhotoInput(photoURL || ""); }} className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-indigo-100 text-indigo-700 ring-2 ring-transparent hover:ring-indigo-300 transition-all shrink-0">
              {avatarContent}
            </button>
            <div className="text-right">
              <p className="text-xs font-semibold text-slate-800 leading-tight">{userName || userEmail}</p>
              {userName && <p className="text-[10px] text-slate-400 leading-tight">{userEmail}</p>}
              <Badge variant="default" className="text-[9px] px-1.5 py-0 mt-0.5">{roleLabel[userRole] || userRole}</Badge>
            </div>

            {photoPopover && (
              <div ref={popoverRef} className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-border bg-white p-4 shadow-lg z-50">
                <p className="text-xs font-semibold text-slate-700 mb-2">Profile Photo</p>

                {photoPreview && (
                  <div className="mb-2 flex justify-center">
                    <img src={photoPreview} alt="Preview" className="h-16 w-16 rounded-full object-cover border-2 border-indigo-200" />
                  </div>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500 hover:border-indigo-400 hover:text-indigo-600 transition-colors"
                >
                  Choose from Gallery
                </button>

                <div className="flex items-center gap-2 my-2">
                  <div className="h-px flex-1 bg-slate-200" />
                  <span className="text-[10px] text-slate-400">or URL</span>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>

                <input
                  type="text"
                  value={photoInput}
                  onChange={(e) => { setPhotoInput(e.target.value); setPhotoPreview(""); }}
                  placeholder="https://example.com/photo.jpg"
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />

                <div className="flex gap-1.5 mt-2">
                  <Button size="sm" onClick={handleSavePhoto} disabled={savingPhoto || (!photoInput.trim() && !photoPreview)} className="bg-indigo-600 text-white text-xs flex-1">
                    {savingPhoto ? "Saving..." : "Save"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setPhotoPopover(false); setPhotoPreview(""); }} className="border-slate-300 text-xs">Cancel</Button>
                </div>
              </div>
            )}
          </div>

          {!mobileOpen && (
            <Button variant="ghost" size="sm" className="md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </Button>
          )}

          <div className="hidden md:block">
            <Button variant="destructive" size="sm" onClick={handleLogout} disabled={isSigningOut}>
              <LogOut className="h-3.5 w-3.5" />
              {isSigningOut ? "Signing out..." : "Sign Out"}
            </Button>
          </div>
        </div>
      </div>

      {mobileOpen && (
        <div className="animate-slide-in-right border-t border-border/40 bg-white/95 backdrop-blur-xl px-4 pb-4 pt-3 md:hidden">
          <div className="mb-3 flex items-center gap-3 rounded-xl border border-border/60 bg-slate-50/80 px-3 py-2">
            <button type="button" onClick={() => { setPhotoPopover(!photoPopover); setPhotoInput(photoURL || ""); }} className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-indigo-100 text-indigo-700 font-bold text-sm ring-2 ring-transparent hover:ring-indigo-300 transition-all">
              {avatarContent}
            </button>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-800">{userName || userEmail}</p>
              {userName && <p className="truncate text-xs text-slate-400">{userEmail}</p>}
              <Badge variant="default" className="text-[10px] mt-0.5">{roleLabel[userRole] || userRole}</Badge>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" onClick={handleLogout} disabled={isSigningOut} className="flex-1">
              <LogOut className="h-4 w-4" />
              {isSigningOut ? "Signing out..." : "Sign Out"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setMobileOpen(false)} aria-label="Close menu">
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}

export default Navbar;
