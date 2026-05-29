import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';

export function Scene1() {
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
      initial={{ opacity: 0, filter: "blur(20px)", scale: 1.05 }}
      animate={{ opacity: 1, filter: "blur(0px)", scale: 1 }}
      exit={{ opacity: 0, filter: "blur(15px)", scale: 0.95 }}
      transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="z-10 text-center max-w-[70vw] px-8">
        <motion.p 
          className="text-[#53d8fb] uppercase tracking-[0.3em] font-semibold mb-8 text-2xl"
          initial={{ opacity: 0, y: 30 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ duration: 1.2, ease: "easeOut" }}
        >
          The Problem
        </motion.p>
        
        <motion.h1 
          className="text-[5vw] leading-tight font-bold mb-12 tracking-tight"
          initial={{ opacity: 0, y: 40 }}
          animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
          transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
        >
          AI agents in healthcare <br/>
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-red-600">act without a paper trail.</span>
        </motion.h1>

        <div className="flex justify-center gap-16 text-[2vw] text-slate-400 font-medium mt-16">
          {[
            { text: "Who authorized it?", p: 3 }, 
            { text: "What did it do?", p: 4 }, 
            { text: "When?", p: 5 }
          ].map((q, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -30, filter: "blur(10px)" }}
              animate={phase >= q.p ? { opacity: 1, x: 0, filter: "blur(0px)" } : { opacity: 0, x: -30, filter: "blur(10px)" }}
              transition={{ duration: 1.2, ease: "easeOut" }}
            >
              {q.text}
            </motion.div>
          ))}
        </div>
      </div>
      
      {/* Decorative scanning line */}
      <motion.div 
        className="absolute w-[1px] h-full bg-gradient-to-b from-transparent via-red-500/50 to-transparent right-[15%]"
        initial={{ top: "-100%", opacity: 0 }}
        animate={phase >= 2 ? { top: ["-100%", "100%"], opacity: [0, 1, 0] } : {}}
        transition={{ duration: 6, ease: "linear", repeat: Infinity }}
      />
    </motion.div>
  );
}
