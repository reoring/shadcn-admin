import { useState } from 'react'
import { Loader2, LogIn } from 'lucide-react'
import { signIn } from '@/lib/auth-client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface UserAuthFormProps extends React.HTMLAttributes<HTMLDivElement> {
  redirectTo?: string
}

export function UserAuthForm({
  className,
  redirectTo,
  ...props
}: UserAuthFormProps) {
  const [isLoading, setIsLoading] = useState(false)

  const handleSignIn = () => {
    setIsLoading(true)
    const callbackUrl = redirectTo
      ? new URL(redirectTo, window.location.origin).toString()
      : window.location.origin
    signIn('keycloak', callbackUrl)
  }

  return (
    <div className={cn('grid gap-3', className)} {...props}>
      <Button className='w-full' disabled={isLoading} onClick={handleSignIn}>
        {isLoading ? <Loader2 className='animate-spin' /> : <LogIn />}
        Sign in with Keycloak
      </Button>
    </div>
  )
}
