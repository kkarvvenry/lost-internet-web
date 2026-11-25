import { MotionConfig } from 'framer-motion'
import { LostInternetApp } from './components/LostInternetApp'

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <LostInternetApp />
    </MotionConfig>
  )
}
