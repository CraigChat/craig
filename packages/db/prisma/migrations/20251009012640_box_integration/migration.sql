-- CreateTable
CREATE TABLE "BoxUser" (
    "id" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "BoxUser_pkey" PRIMARY KEY ("id")
);
