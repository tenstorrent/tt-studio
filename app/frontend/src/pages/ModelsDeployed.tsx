import { ModelsDeployedTable } from "../components/ModelsDeployedTable";

const ModelsDeployed = () => {
  return (
    <div className=" h-screen flex-1 w-full dark:bg-black bg-white dark:bg-dot-white/[0.2] bg-dot-black/[0.2] relative flex items-center justify-center ">
      {/* Radial gradient for the container to give a faded look */}
      <div
        className="absolute pointer-events-none inset-0 flex items-center justify-center dark:bg-black bg-white"
        style={{
          maskImage:
            "radial-gradient(ellipse at center, transparent 65%, black 100%)",
        }}
      ></div>
      <div className="flex flex-col h-screen w-full md:px-20 pt-12 pb-28 overflow-hidden">
        <ModelsDeployedTable />
      </div>
    </div>
  );
};

export default ModelsDeployed;
