'use client';

import { Rocket } from 'lucide-react';
import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="bg-gray-900 text-gray-400 py-10">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <Rocket className="w-4 h-4 text-white" />
            </div>
            <span className="text-white font-bold">Launch Connect</span>
          </div>
          <div className="flex items-center gap-6 text-sm">
            <Link href="/" className="hover:text-white transition-colors">Home</Link>
            <Link href="/dashboard" className="hover:text-white transition-colors">Dashboard</Link>
            <a href="#core-services" className="hover:text-white transition-colors">Services</a>
            <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
          </div>
          <p className="text-xs text-gray-500">&copy; {new Date().getFullYear()} Launch Marketing</p>
        </div>
      </div>
    </footer>
  );
}
