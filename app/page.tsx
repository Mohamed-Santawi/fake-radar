import Link from "next/link";
import { ShieldCheck, Video, Radar } from "lucide-react";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4">
      {/* Hero Section */}
      <div className="max-w-4xl w-full text-center space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
        <div className="inline-flex items-center justify-center p-3 rounded-full bg-primary/10 text-primary mb-4 w-20 h-20 shadow-[0_0_30px_rgba(0,229,59,0.3)]">
          <DelayRadar />
        </div>

        <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white">
          اكتشف <span className="text-transparent bg-clip-text bg-gradient-to-l from-primary to-emerald-300">التزييف العميق</span> بلمح البصر
        </h1>

        <p className="text-xl md:text-2xl text-foreground/70 max-w-2xl mx-auto leading-relaxed">
          نظام رصد متطور يعتمد على خوارزميات الذكاء الاصطناعي لتحليل الفيديوهات والصور واكتشاف المحتوى المزيف (Deepfake) بدقة متناهية.
        </p>

        <div className="pt-8 mb-16">
          <Link
            href="/analyze"
            className="group relative inline-flex items-center justify-center gap-3 px-8 py-4 text-lg font-bold text-black bg-primary rounded-full overflow-hidden transition-all hover:scale-105 hover:shadow-[0_0_40px_rgba(0,229,59,0.6)] cursor-pointer"
          >
            <span className="absolute inset-0 w-full h-full -ml-16 translate-x-full bg-white opacity-20 group-hover:animate-[shimmer_1.5s_infinite] ease"></span>
            ابدأ التحليل الآن
            <Radar className="w-5 h-5 animate-pulse" />
          </Link>
        </div>
      </div>

      {/* Features */}
      <div className="max-w-6xl w-full grid grid-cols-1 md:grid-cols-3 gap-8 mt-16 px-4">
        <FeatureCard
          icon={<ShieldCheck className="w-8 h-8 text-primary" />}
          title="دقة عالية"
          description="تحليل عميق يعتمد على Sightengine API لاكتشاف التمويه وتغيير الوجوه بنسبة ثقة عالية."
        />
        <FeatureCard
          icon={<Video className="w-8 h-8 text-primary" />}
          title="يدعم الفيديو والصور"
          description="ضع أي رابط لمقطع فيديو أو صورة وسنقوم بجلبه وتحليله بصرياً عبر محرك الذكاء الاصطناعي."
        />
        <FeatureCard
          icon={<Radar className="w-8 h-8 text-primary" />}
          title="استجابة فورية"
          description="يتم فحص الوسائط على خوادم فائقة السرعة، لتستلم التقرير في لمح البصر."
        />
      </div>
    </div>
  );
}

function DelayRadar() {
  return (
    <Radar className="w-10 h-10 animate-pulse-radar" />
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) {
  return (
    <div className="bg-surface/50 border border-border/50 rounded-3xl p-8 backdrop-blur-sm hover:border-primary/50 transition-colors group">
      <div className="w-14 h-14 bg-background rounded-2xl flex items-center justify-center mb-6 shadow-inner group-hover:scale-110 transition-transform">
        {icon}
      </div>
      <h3 className="text-xl font-bold mb-3 text-white">{title}</h3>
      <p className="text-foreground/60 leading-relaxed">
        {description}
      </p>
    </div>
  );
}
