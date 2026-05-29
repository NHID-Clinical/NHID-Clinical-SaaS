import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';

export function Scene5() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 1000),
      setTimeout(() => setPhase(2), 3500),
      setTimeout(() => setPhase(3), 6000),
      setTimeout(() => setPhase(4), 9000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center overflow-hidden"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="z-20 text-center flex flex-col items-center">
        <motion.div
          className="w-[12vw] h-[12vw] mb-12 relative flex items-center justify-center"
          initial={{ scale: 0, rotate: -180 }}
          animate={phase >= 1 ? { scale: 1, rotate: 0 } : { scale: 0, rotate: -180 }}
          transition={{ duration: 1.5, type: "spring", bounce: 0.2 }}
        >
          <div className="absolute inset-0 border-[0.5vw] border-[#00c2a8] rounded-3xl rotate-45 shadow-[0_0_40px_rgba(0,194,168,0.4)]" />
          <div className="absolute inset-0 border-[0.5vw] border-[#53d8fb] rounded-3xl shadow-[0_0_40px_rgba(83,216,251,0.2)]" />
          <span className="text-[5vw] font-black tracking-tighter z-10 text-white">N</span>
        </motion.div>

        <motion.h1 
          className="text-[6vw] font-bold tracking-tight mb-8"
          initial={{ opacity: 0, y: 40, filter: "blur(10px)" }}
          animate={phase >= 2 ? { opacity: 1, y: 0, filter: "blur(0px)" } : { opacity: 0, y: 40, filter: "blur(10px)" }}
          transition={{ duration: 1.5 }}
        >
          NHID Clinical
        </motion.h1>

        <motion.p 
          className="text-[2.2vw] text-slate-300 font-light tracking-wide max-w-[60vw]"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 1.5 }}
        >
          Proof of accountability for AI in healthcare.
        </motion.p>
      </div>

      {/* Dramatic closing light effect */}
      <motion.div 
        className="absolute inset-0 bg-gradient-to-t from-[#00c2a8]/20 to-transparent mix-blend-screen pointer-events-none z-10"
        initial={{ opacity: 0 }}
        animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
        transition={{ duration: 3 }}
      />
      
      {/* Background slow zoom */}
      <motion.div
        className="absolute inset-0 bg-[radial-gradient(circle_at_center,_#00c2a8_0%,_transparent_50%)] opacity-5 z-0"
        initial={{ scale: 1 }}
        animate={phase >= 1 ? { scale: 2 } : { scale: 1 }}
        transition={{ duration: 10, ease: "easeOut" }}
      />
    </motion.div>
  );
}
