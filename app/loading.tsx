import { Radar } from "lucide-react";

export default function Loading() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center min-h-[50vh] animate-in fade-in duration-300">
      <div className="relative w-24 h-24 flex items-center justify-center mb-4">
        <div className="absolute inset-0 border-4 border-primary/20 rounded-full"></div>
        <div className="absolute inset-0 border-4 border-primary rounded-full border-t-transparent animate-spin"></div>
        <Radar className="w-8 h-8 text-primary animate-pulse-radar" />
      </div>
      <h3 className="text-lg font-bold text-primary animate-pulse tracking-wide">جاري التحميل...</h3>
    </div>
  );
}
