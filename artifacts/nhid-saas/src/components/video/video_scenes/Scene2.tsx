import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 800),
      setTimeout(() => setPhase(2), 2500),
      setTimeout(() => setPhase(3), 4500),
      setTimeout(() => setPhase(4), 6500),
      setTimeout(() => setPhase(5), 8500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.05 }}
      transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="flex w-full px-[10vw] items-center justify-between z-10 h-full">
        
        <div className="max-w-[40vw]">
          <motion.p 
            className="text-[#00c2a8] uppercase tracking-[0.3em] font-semibold mb-6 text-2xl"
            initial={{ opacity: 0, x: -30 }}
            animate={phase >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: -30 }}
            transition={{ duration: 1.2 }}
          >
            The Engine
          </motion.p>
          
          <motion.h2 
            className="text-[4.5vw] font-bold mb-10 leading-tight tracking-tight"
            initial={{ opacity: 0, y: 30 }}
            animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
            transition={{ duration: 1.2 }}
          >
            Cryptographically <br/>Provable.
          </motion.h2>
          
          <motion.p
            className="text-[1.8vw] text-slate-300 leading-relaxed font-light"
            initial={{ opacity: 0, y: 20 }}
            animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
            transition={{ duration: 1.5 }}
          >
            Every AI agent action is hash-chained and tamper-evident. NHID Core runs in-process to ensure immutable audit logs.
          </motion.p>
        </div>

        {/* Visual representation of a hash chain */}
        <div className="relative w-[30vw] h-[60vh] flex flex-col justify-center">
          {[1, 2, 3].map((block, i) => (
            <motion.div
              key={block}
              className="relative w-full border border-[#00c2a8]/30 bg-[#00c2a8]/5 backdrop-blur-xl rounded-2xl p-6 mb-12 shadow-[0_10px_30px_rgba(0,194,168,0.1)]"
              initial={{ opacity: 0, x: 50, filter: "blur(10px)" }}
              animate={phase >= (i + 2) ? { opacity: 1, x: 0, filter: "blur(0px)" } : { opacity: 0, x: 50, filter: "blur(10px)" }}
              transition={{ duration: 1, type: "spring", bounce: 0.2 }}
            >
              <div className="flex justify-between items-center mb-3">
                <div className="text-sm text-[#00c2a8] font-mono tracking-widest uppercase">Block 00{block}</div>
                <div className="w-2 h-2 rounded-full bg-[#00c2a8] shadow-[0_0_8px_#00c2a8]" />
              </div>
              <div className="text-[1.1vw] font-mono truncate text-slate-400 mb-1">
                prev: {i === 0 ? "0x0000000000000000" : `0x${(Math.random()*0xFFFFFFFF<<0).toString(16)}...`}
              </div>
              <div className="text-[1.1vw] font-mono truncate text-white">
                hash: 0x{(Math.random()*0xFFFFFFFF<<0).toString(16)}...
              </div>
              
              {/* Connecting line */}
              {i < 2 && (
                <motion.div 
                  className="absolute w-[2px] bg-gradient-to-b from-[#00c2a8] to-transparent"
                  style={{ left: '50%', top: '100%', bottom: '-3rem', originY: 0 }}
                  initial={{ scaleY: 0 }}
                  animate={phase >= (i + 3) ? { scaleY: 1 } : { scaleY: 0 }}
                  transition={{ duration: 0.8 }}
                />
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
