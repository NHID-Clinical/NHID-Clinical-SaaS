import { motion, AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video/hooks';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';

const SCENE_DURATIONS = { open: 12000, engine: 12000, platform: 12000, proof: 12000, close: 12000 };

export default function VideoTemplate() {
  const { currentScene } = useVideoPlayer({ durations: SCENE_DURATIONS });

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#070c17] text-white" style={{ fontFamily: 'Raleway, sans-serif' }}>
      {/* Persistent Background */}
      <div className="absolute inset-0 z-0">
        <motion.div className="absolute w-[80vw] h-[80vw] rounded-full opacity-[0.07] blur-3xl"
          style={{ background: 'radial-gradient(circle, #00c2a8, transparent)' }}
          animate={{ 
            x: ['-20%', '50%', '10%'], 
            y: ['0%', '40%', '10%'], 
            scale: [1, 1.2, 0.9] 
          }}
          transition={{ duration: 25, repeat: Infinity, ease: 'easeInOut' }} 
        />
        <motion.div className="absolute w-[60vw] h-[60vw] rounded-full opacity-[0.07] blur-3xl right-0 bottom-0"
          style={{ background: 'radial-gradient(circle, #53d8fb, transparent)' }}
          animate={{ 
            x: ['20%', '-30%', '5%'], 
            y: ['-10%', '-50%', '-20%'] 
          }}
          transition={{ duration: 30, repeat: Infinity, ease: 'easeInOut' }} 
        />
        {/* Subtle grid pattern */}
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxwYXRoIGQ9Ik02MCAwaC02MHY2MGg2MFYwekw1OSA1OXYtNThoLTU4djU4aDU4eiIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjAyKSIgZmlsbC1ydWxlPSJldmVub2RkIi8+Cjwvc3ZnPg==')] opacity-30" />
      </div>

      {/* Persistent Midground */}
      <motion.div
        className="absolute w-32 h-32 rounded-full bg-[#00c2a8]/20 blur-2xl"
        animate={{
          x: ['20vw', '80vw', '10vw', '70vw', '50vw'][currentScene],
          y: ['30vh', '70vh', '20vh', '80vh', '50vh'][currentScene],
          scale: [1, 1.5, 0.8, 1.2, 2][currentScene],
        }}
        transition={{ duration: 3, ease: [0.16, 1, 0.3, 1] }}
      />
      <motion.div
        className="absolute h-[1px] bg-gradient-to-r from-transparent via-[#53d8fb]/40 to-transparent"
        animate={{
          left: ['10%', '0%', '20%', '10%', '0%'][currentScene],
          width: ['80%', '100%', '60%', '80%', '100%'][currentScene],
          top: ['60%', '20%', '80%', '30%', '50%'][currentScene],
          opacity: [0.3, 0.5, 0.2, 0.6, 0][currentScene],
        }}
        transition={{ duration: 2.5, ease: [0.22, 1, 0.36, 1] }}
      />

      {/* Foreground Scenes */}
      <div className="relative z-10 w-full h-full">
        <AnimatePresence mode="popLayout">
          {currentScene === 0 && <Scene1 key="open" />}
          {currentScene === 1 && <Scene2 key="engine" />}
          {currentScene === 2 && <Scene3 key="platform" />}
          {currentScene === 3 && <Scene4 key="proof" />}
          {currentScene === 4 && <Scene5 key="close" />}
        </AnimatePresence>
      </div>
    </div>
  );
}
