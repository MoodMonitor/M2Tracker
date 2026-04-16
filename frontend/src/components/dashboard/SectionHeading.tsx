const SectionHeading = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-4 text-center">
    <h2 className="fantasy-heading fantasy-heading-large text-[hsl(45_70%_60%)] mb-2 hover:text-[hsl(45_70%_70%)] transition-all duration-300 cursor-default hover:scale-105">
      {children}
    </h2>
    <div className="relative mx-auto">
      <div className="w-32 h-1 bg-gradient-to-r from-transparent via-[hsl(45_70%_60%)] to-transparent mx-auto rounded-full shadow-[0_0_10px_hsl(45_70%_60%_/_0.6)]"></div>
      <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-2 h-1 bg-[hsl(45_70%_60%)] rounded-full shadow-[0_0_8px_hsl(45_70%_60%_/_0.8)]"></div>
    </div>
  </div>
);

export default SectionHeading;