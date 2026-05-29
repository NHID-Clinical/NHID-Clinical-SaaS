import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 1000),
      setTimeout(() => setPhase(2), 3500),
      setTimeout(() => setPhase(3), 6000),
      setTimeout(() => setPhase(4), 8500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.1, filter: "blur(20px)" }}
      transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="relative w-[85vw] h-[75vh] border border-white/10 rounded-3xl bg-[#0b1221]/80 backdrop-blur-3xl shadow-2xl overflow-hidden flex shadow-[#00c2a8]/10">
        
        {/* Sidebar */}
        <div className="w-[20%] border-r border-white/10 p-8 flex flex-col gap-6 bg-black/20">
          <motion.div 
            className="h-8 w-3/4 bg-white/20 rounded-md"
            initial={{ opacity: 0, x: -20 }}
            animate={phase >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
            transition={{ duration: 0.8 }}
          />
          <div className="space-y-4 mt-8">
             {[1,2,3,4,5,6].map(i => (
               <motion.div 
                 key={i} 
                 className="h-4 w-full bg-white/5 rounded-md"
                 initial={{ opacity: 0, x: -20 }}
                 animate={phase >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
                 transition={{ delay: i * 0.1, duration: 0.6 }}
               />
             ))}
          </div>
        </div>

        {/* Main Content: The Proof */}
        <div className="flex-1 p-16 relative flex flex-col justify-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
            transition={{ duration: 1 }}
          >
            <h2 className="text-[3vw] font-bold mb-4 tracking-tight">Audit Proof Export</h2>
            <p className="text-[1.5vw] text-slate-400 mb-16">Cryptographic session verification</p>
          </motion.div>

          {/* Verification Box */}
          <motion.div 
            className="border-2 border-[#00c2a8]/40 bg-gradient-to-br from-[#00c2a8]/10 to-transparent rounded-3xl p-12 text-center relative overflow-hidden"
            initial={{ scale: 0.9, opacity: 0, y: 50 }}
            animate={phase >= 2 ? { scale: 1, opacity: 1, y: 0 } : { scale: 0.9, opacity: 0, y: 50 }}
            transition={{ duration: 1.2, type: "spring", bounce: 0.1 }}
          >
            <motion.div 
              className="text-[6vw] text-[#00c2a8] mb-6 drop-shadow-[0_0_20px_rgba(0,194,168,0.8)]"
              initial={{ rotate: -90, opacity: 0, scale: 0 }}
              animate={phase >= 3 ? { rotate: 0, opacity: 1, scale: 1 } : { rotate: -90, opacity: 0, scale: 0 }}
              transition={{ duration: 1, type: "spring", bounce: 0.4 }}
            >
              ✓
            </motion.div>
            <motion.h3 
              className="text-[4vw] font-black text-white mb-4 tracking-widest uppercase"
              initial={{ opacity: 0, y: 20 }}
              animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
              transition={{ duration: 0.8, delay: 0.2 }}
            >
              VALID_CHAIN
            </motion.h3>
            <motion.p 
              className="text-slate-300 text-[1.5vw] font-light"
              initial={{ opacity: 0 }}
              animate={phase >= 4 ? { opacity: 1 } : { opacity: 0 }}
              transition={{ duration: 1 }}
            >
              Unambiguous accountability. Zero tampering.
            </motion.p>
            
            {/* Scanning effect */}
            <motion.div 
               className="absolute left-0 right-0 h-[2px] bg-[#00c2a8] shadow-[0_0_20px_4px_#00c2a8]"
               initial={{ top: 0, opacity: 0 }}
               animate={phase >= 2 ? { top: ["0%", "100%", "0%"], opacity: [0, 1, 0] } : {}}
               transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
            />
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}
