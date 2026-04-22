"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, ShieldAlert, ShieldCheck, Radar } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { motion } from "framer-motion";

function ResultContent() {
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const scoreStr = searchParams.get("score");
  const status = searchParams.get("status");
  const provider = searchParams.get("provider") || "unknown";

  const score = scoreStr ? parseFloat(scoreStr) : 0;
  const isFake = status === "fake";

  const percentage = Math.round(score * 100);

  return (
    <div className="flex-1 flex flex-col items-center justify-center py-12 px-4">
      <div className="max-w-xl w-full">
        <div className={`p-1 rounded-[2rem] bg-gradient-to-br shadow-2xl ${isFake ? 'from-red-500/50 to-red-900/50 shadow-red-500/20' : 'from-primary/50 to-emerald-900/50 shadow-primary/20'}`}>
          <div className="bg-surface/90 border border-transparent rounded-[31px] p-8 md:p-12 text-center relative overflow-hidden backdrop-blur-3xl">
            {/* Background Scanner Effect */}
            <div className="absolute inset-0 opacity-10 pointer-events-none">
              <div className="absolute top-0 w-full h-[2px] bg-white animate-scan-line shadow-[0_0_10px_white]"></div>
            </div>

            <motion.div 
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", duration: 0.7 }}
              className="relative inline-flex items-center justify-center w-32 h-32 rounded-full mb-8"
            >
              <div className={`absolute inset-0 rounded-full opacity-20 animate-ping ${isFake ? 'bg-red-500' : 'bg-primary'}`}></div>
              {isFake ? (
                <ShieldAlert className="w-16 h-16 text-red-500 relative z-10" />
              ) : (
                <ShieldCheck className="w-16 h-16 text-primary relative z-10" />
              )}
            </motion.div>

            <motion.h1 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className={`text-4xl md:text-5xl font-extrabold mb-4 ${isFake ? 'text-red-500' : 'text-primary'}`}
            >
              {isFake ? "محتوى مزيف!" : "محتوى حقيقي"}
            </motion.h1>

            <motion.p 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="text-xl text-foreground/80 mb-10 leading-relaxed max-w-md mx-auto"
            >
              {isFake 
                ? "تشير تحليلات الذكاء الاصطناعي إلى وجود نسبة عالية للتمويه والتلاعب كالتزييف العميق."
                : "لم نكتشف أي آثار للتزييف العميق في هذا المحتوى بناءً على التحليل البصري."}
            </motion.p>

            <motion.div 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="bg-background/80 rounded-2xl p-6 border border-border/50 mb-10 text-left"
            >
              <div className="flex justify-between text-sm font-medium mb-3 items-center" dir="rtl">
                <span className="text-foreground/70">تطابق التزييف العميق (Deepfake)</span>
                <span className={`text-xl font-bold ${isFake ? 'text-red-400' : 'text-primary'}`}>{percentage}%</span>
              </div>
              <div className="h-4 w-full bg-background rounded-full overflow-hidden border border-border">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${percentage}%` }}
                  transition={{ delay: 0.8, duration: 1, ease: "easeOut" }}
                  className={`h-full rounded-full ${isFake ? 'bg-red-500' : 'bg-primary'}`}
                ></motion.div>
              </div>
              <div className="mt-3 text-xs text-foreground/40 text-right" dir="rtl">
                مزود التحليل: <span className="font-mono text-foreground/60">{provider}</span>
              </div>
            </motion.div>

            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.5 }}
            >
              <Link
                href="/analyze" 
                className="inline-flex items-center gap-2 text-foreground/70 hover:text-white transition-colors bg-surface border border-border px-6 py-3 rounded-xl hover:bg-border/50 cursor-pointer"
              >
                <ArrowRight className="w-5 h-5" />
                فحص رابط جديد
              </Link>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ResultPage() {
  return (
    <Suspense fallback={
      <div className="flex-1 flex flex-col items-center justify-center min-h-[50vh] animate-in fade-in duration-300">
        <div className="relative w-24 h-24 flex items-center justify-center mb-4">
          <div className="absolute inset-0 border-4 border-primary/20 rounded-full"></div>
          <div className="absolute inset-0 border-4 border-primary rounded-full border-t-transparent animate-spin"></div>
          <Radar className="w-8 h-8 text-primary animate-pulse-radar" />
        </div>
        <h3 className="text-lg font-bold text-primary animate-pulse tracking-wide">جاري إعداد التقرير...</h3>
      </div>
    }>
      <ResultContent />
    </Suspense>
  );
}
