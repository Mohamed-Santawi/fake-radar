"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Radar, Link as LinkIcon, AlertCircle } from "lucide-react";

export default function AnalyzePage() {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) {
      setError("الرجاء إدخال رابط صالح");
      return;
    }

    try {
      setIsLoading(true);
      setError("");

      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "حدث خطأ غير متوقع");
      }

      const deepfakeScore = data.type?.deepfake || 0;
      const isFake = deepfakeScore > 0.5;

      router.push(`/result?score=${deepfakeScore}&status=${isFake ? 'fake' : 'real'}`);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "حدث خطأ أثناء الاتصال بالخادم");
      setIsLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center py-12 px-4">
      <div className="max-w-2xl w-full animate-in fade-in zoom-in-95 duration-500">
        <h1 className="text-3xl font-bold mb-8 text-center text-white">أداة الفحص</h1>

        <div className="bg-surface/50 border border-border/70 rounded-3xl p-8 backdrop-blur-xl shadow-[0_0_40px_rgba(0,0,0,0.5)] relative overflow-hidden">
          {isLoading && (
            <div className="absolute inset-0 bg-background/90 backdrop-blur-sm z-10 flex flex-col items-center justify-center">
              <div className="relative w-32 h-32 flex items-center justify-center mb-6">
                <div className="absolute inset-0 border-4 border-primary/20 rounded-full"></div>
                <div className="absolute inset-0 border-4 border-primary rounded-full border-t-transparent animate-spin"></div>
                <Radar className="w-10 h-10 text-primary animate-pulse-radar" />
              </div>
              <h3 className="text-xl font-bold text-primary animate-pulse">جاري التحليل المعمق...</h3>
              <p className="text-foreground/60 text-sm mt-3 animate-pulse text-center max-w-xs">
                يقوم الذكاء الاصطناعي الآن بمعالجة البكسلات والتأكد من موثوقية المحتوى
              </p>
            </div>
          )}

          <form onSubmit={handleAnalyze} className="space-y-6">
            <div>
              <label htmlFor="url" className="block text-sm font-medium text-foreground/80 mb-3">
                رابط المحتوى (صورة أو فيديو)
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 right-0 pr-4 flex items-center text-foreground/40 pointer-events-none">
                  <LinkIcon className="h-5 w-5" />
                </div>
                <input
                  type="url"
                  name="url"
                  id="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="block w-full bg-background border border-border rounded-xl py-4 pr-12 pl-4 text-foreground focus:ring-2 focus:ring-primary focus:border-primary transition-all text-left outline-none"
                  placeholder="https://example.com/video.mp4"
                  dir="ltr"
                  disabled={isLoading}
                  required
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-3 text-red-500 bg-red-500/10 p-4 rounded-xl border border-red-500/20">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <p className="text-sm">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-3 bg-primary hover:bg-primary/90 text-black font-bold py-4 px-8 rounded-xl transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:pointer-events-none disabled:transform-none shadow-[0_0_20px_rgba(0,229,59,0.3)] cursor-pointer"
            >
              <Radar className="w-5 h-5" />
              بدء الفحص السريع
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
