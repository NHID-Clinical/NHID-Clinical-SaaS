import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 1000),
      setTimeout(() => setPhase(2), 3000),
      setTimeout(() => setPhase(3), 5000),
      setTimeout(() => setPhase(4), 7000),
      setTimeout(() => setPhase(5), 9000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center overflow-hidden"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.05, filter: "blur(15px)" }}
      transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="text-center z-20 w-full px-[5vw]">
        <motion.p 
          className="text-[#53d8fb] uppercase tracking-[0.3em] font-semibold mb-8 text-2xl"
          initial={{ opacity: 0, y: -30 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: -30 }}
          transition={{ duration: 1.2 }}
        >
          The Platform
        </motion.p>

        <motion.h2 
          className="text-[4.5vw] font-bold mb-20 tracking-tight"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 1.2 }}
        >
          Multi-tenant. Production-ready.
        </motion.h2>

        <div className="flex justify-center gap-12 w-full max-w-[80vw] mx-auto">
          {[
            { title: "L1 Baseline", price: "$0", color: "#53d8fb", desc: "Core audit engine" },
            { title: "L2 Operational", price: "$499", color: "#00c2a8", desc: "Multi-tenant + Dashboards", popular: true },
            { title: "L3 Enterprise", price: "Custom", color: "#8b5cf6", desc: "Dedicated infrastructure" }
          ].map((tier, i) => (
            <motion.div
              key={tier.title}
              className={`flex-1 p-[3vw] rounded-3xl border border-white/10 bg-[#0a1122]/60 backdrop-blur-2xl text-left relative overflow-hidden ${tier.popular ? 'shadow-[0_20px_50px_rgba(0,194,168,0.15)] scale-105' : ''}`}
              initial={{ opacity: 0, y: 60 }}
              animate={phase >= (3 + i) ? { opacity: 1, y: 0 } : { opacity: 0, y: 60 }}
              transition={{ duration: 1, type: "spring", bounce: 0.1 }}
            >
              <div 
                className="absolute top-0 left-0 w-full h-2" 
                style={{ backgroundColor: tier.color }} 
              />
              <h3 className="text-[1.8vw] font-semibold mb-3">{tier.title}</h3>
              <div className="text-[3vw] font-bold mb-4">{tier.price}<span className="text-[1vw] text-slate-400 font-normal">/mo</span></div>
              <p className="text-[1.2vw] text-slate-400 mb-8">{tier.desc}</p>
              <div className="space-y-4">
                {[1,2,3,4].map(item => (
                  <div key={item} className="h-3 bg-white/10 rounded-full w-full" />
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
      
      {/* Background UI Grid */}
      <motion.div
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-white/[0.03] via-transparent to-transparent z-0"
        initial={{ opacity: 0 }}
        animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
        transition={{ duration: 2 }}
      />
    </motion.div>
  );
}
