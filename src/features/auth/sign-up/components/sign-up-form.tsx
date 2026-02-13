import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { signIn } from '@/lib/auth-client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export function SignUpForm({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const [isLoading, setIsLoading] = useState(false)

  const handleSignUp = () => {
    setIsLoading(true)
    // Keycloak handles registration via its built-in registration flow.
    // The user will see a "Register" link on the Keycloak login page.
    signIn('keycloak', window.location.origin)
  }

  return (
    <div className={cn('grid gap-3', className)} {...props}>
      <p className='text-center text-sm text-muted-foreground'>
        You will be redirected to our identity provider to create your account.
      </p>
      <Button className='w-full' disabled={isLoading} onClick={handleSignUp}>
        {isLoading ? <Loader2 className='animate-spin' /> : null}
        Create Account
      </Button>
    </div>
  )
}
