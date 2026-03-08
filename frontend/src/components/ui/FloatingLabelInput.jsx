import { forwardRef } from 'react'

import { cn } from '../../lib/cn'

const FloatingLabelInput = forwardRef(function FloatingLabelInput(
  { className, id, label, type = 'text', ...props },
  ref,
) {
  return (
    <div className="relative">
      <input
        ref={ref}
        id={id}
        type={type}
        className={cn(
          'peer h-14 w-full rounded-2xl border border-slate-200 bg-white px-4 pt-5 text-sm text-slate-900 outline-none transition duration-200 placeholder:text-transparent focus:border-iim-blue focus:shadow-glow-blue',
          className,
        )}
        placeholder={label}
        {...props}
      />
      <label
        htmlFor={id}
        className="pointer-events-none absolute left-4 top-4 origin-[0] -translate-y-2 scale-75 text-xs font-medium text-slate-500 transition-all duration-200 peer-placeholder-shown:translate-y-0 peer-placeholder-shown:scale-100 peer-placeholder-shown:text-sm peer-focus:-translate-y-2 peer-focus:scale-75 peer-focus:text-xs peer-focus:text-iim-blue"
      >
        {label}
      </label>
    </div>
  )
})

export default FloatingLabelInput
